// Build an offline test bundle from a source checkout with the pinned Rust/WASM tools.
import { spawn } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';

export async function archiveServerBundle(destination, run) {
  const archive = `${destination}.tar.gz`;
  if (existsSync(archive)) throw Error('Bundle archive already exists.');
  await run('tar', ['-czf', archive, '-C', resolve(destination, '..'), destination.split(sep).at(-1)]);
  return archive;
}

export async function runMakeBundle(argv, options = {}) {
const destination = resolve(argv[0] ?? '');
const checkout = resolve(options.checkout ?? '.');
if (!argv[0] || destination === checkout || destination.startsWith(checkout + sep)) throw Error('Supply a new output directory outside the checkout.');
if (existsSync(`${destination}.tar.gz`)) throw Error('Bundle archive already exists.');
const engine = argv.includes('--docker') ? 'docker' : 'podman';
const issuerKeysPath = argv.find((value, index) => argv[index - 1] === '--issuer-public-keys');
if (argv.includes('--issuer-public-keys') && !issuerKeysPath) throw Error('Supply --issuer-public-keys <trusted public-key catalogue>.');
let issuerKeys;
if (issuerKeysPath) {
  issuerKeys = JSON.parse(await readFile(resolve(issuerKeysPath), 'utf8'));
  if (!issuerKeys || typeof issuerKeys !== 'object' || Array.isArray(issuerKeys)
    || Object.keys(issuerKeys).length < 1 || Object.keys(issuerKeys).length > 8) throw Error('Invalid issuer public-key catalogue.');
  for (const [keyId, pem] of Object.entries(issuerKeys)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(keyId) || typeof pem !== 'string' || createPublicKey(pem).asymmetricKeyType !== 'ed25519') {
      throw Error('Invalid issuer public-key catalogue.');
    }
  }
}
async function run(program, args, { capture = false } = {}) {
  const child = spawn(program, args, { cwd: checkout, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', windowsHide: true });
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk; });
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
  if (code !== 0) throw Error(`${program} failed (${code}).`);
  return output.trim();
}
async function hash(path) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest('hex');
}
await mkdir(destination, { recursive: false });
await mkdir(join(destination, 'lib'));
if (issuerKeys) await writeFile(join(destination, 'issuer-keys.json'), JSON.stringify(issuerKeys, null, 2) + '\n', { flag: 'wx' });
await run(process.execPath, ['scripts/build-fixture.mjs']);
const image = options.image ?? 'localhost/127vaults-server:test';
await run(engine, ['build', ...(options.refreshImages ? [engine === 'docker' ? '--pull' : '--pull=always'] : []), '-t', image, '-f', 'apps/server/Dockerfile', '.']);
await run(engine, ['pull', 'docker.io/library/postgres:17-bookworm']);
await run(engine, ['pull', 'docker.io/alpine/openssl:3.5.4']);
await run(engine, ['save', '-o', join(destination, 'server-image.tar'), image]);
await run(engine, ['save', '-o', join(destination, 'postgres-image.tar'), 'docker.io/library/postgres:17-bookworm']);
await run(engine, ['save', '-o', join(destination, 'openssl-image.tar'), 'docker.io/alpine/openssl:3.5.4']);
for (const [source, target] of [
  ['deploy/compose.test.yaml', 'compose.test.yaml'],
  ['deploy/compose.smtp.yaml', 'compose.smtp.yaml'],
  ['server.mjs', 'server.mjs'],
  ['deploy/install.mjs', 'install.mjs'],
  ['deploy/install.ps1', 'install.ps1'],
  ['deploy/install.sh', 'install.sh'],
  ['deploy/test-install.mjs', 'lib/test-install.mjs'],
  ['deploy/private-network.mjs', 'lib/private-network.mjs'],
  ['deploy/upgrade.mjs', 'lib/upgrade.mjs'],
  ['deploy/license-files.mjs', 'lib/license-files.mjs'],
  ['apps/server/src/admin/credentials.mjs', 'lib/admin-credentials.mjs'],
  ['apps/server/src/license-status.mjs', 'lib/license-status.mjs'],
  ['scripts/tls.mjs', 'lib/tls.mjs'],
  ['scripts/ops/backup-envelope.mjs', 'lib/backup-envelope.mjs'],
  ['scripts/ops/server-data.mjs', 'lib/server-data.mjs'],
  ['scripts/ops/identity-backup.mjs', 'lib/identity-backup.mjs'],
  ['docs/release/server-test-install.md', 'README.md'],
  ['LICENSE.md', 'LICENSE.md'], ['COMMERCIAL-LICENSE.md', 'COMMERCIAL-LICENSE.md']
]) await copyFile(join(checkout, source), join(destination, target));
if (image !== 'localhost/127vaults-server:test') {
  const compose = await readFile(join(destination, 'compose.test.yaml'), 'utf8');
  await writeFile(join(destination, 'compose.test.yaml'), compose.replaceAll('localhost/127vaults-server:test', image));
}
const revision = options.provenance?.revision ?? await run('git', ['rev-parse', 'HEAD'], { capture: true });
const changed = options.provenance ? options.provenance.sourceDirty : Boolean(await run('git', ['status', '--porcelain'], { capture: true }));
const imageIds = {};
if (options.provenance) {
  for (const reference of [image, 'docker.io/library/postgres:17-bookworm', 'docker.io/alpine/openssl:3.5.4']) {
    imageIds[reference] = await run(engine, ['image', 'inspect', '--format', '{{.Id}}', reference], { capture: true });
  }
}
const files = {};
for (const name of ['server-image.tar', 'postgres-image.tar', 'openssl-image.tar', 'compose.test.yaml', 'compose.smtp.yaml', 'server.mjs', 'install.mjs', 'install.ps1', 'install.sh', 'lib/test-install.mjs', 'lib/private-network.mjs', 'lib/upgrade.mjs', 'lib/license-files.mjs', 'lib/admin-credentials.mjs', 'lib/license-status.mjs', 'lib/tls.mjs', 'lib/backup-envelope.mjs', 'lib/server-data.mjs', 'lib/identity-backup.mjs', 'README.md', 'LICENSE.md', 'COMMERCIAL-LICENSE.md']) files[name] = await hash(join(destination, name));
if (issuerKeys) files['issuer-keys.json'] = await hash(join(destination, 'issuer-keys.json'));
await writeFile(join(destination, 'manifest.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(), revision, sourceDirty: Boolean(changed), image, ...(options.provenance ? { imageIds } : {}), files }, null, 2) + '\n', { flag: 'wx' });
console.log(`Offline test bundle: ${destination}`);
console.log(`Offline test archive: ${await archiveServerBundle(destination, run)}`);
}

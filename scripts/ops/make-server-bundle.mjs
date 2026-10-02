// Build an offline test bundle from a source checkout with the pinned Rust/WASM tools.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';

export async function runMakeBundle(argv) {
const destination = resolve(argv[0] ?? '');
const checkout = resolve('.');
if (!argv[0] || destination === checkout || destination.startsWith(checkout + sep)) throw Error('Supply a new output directory outside the checkout.');
const engine = argv.includes('--docker') ? 'docker' : 'podman';
async function run(program, args, { capture = false } = {}) {
  const child = spawn(program, args, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', windowsHide: true });
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
await run(process.execPath, ['scripts/build-fixture.mjs']);
await run(engine, ['build', '-t', 'localhost/127vaults-server:test', '-f', 'apps/server/Dockerfile', '.']);
await run(engine, ['pull', 'docker.io/library/postgres:17-bookworm']);
await run(engine, ['pull', 'docker.io/alpine/openssl:3.5.4']);
await run(engine, ['save', '-o', join(destination, 'server-image.tar'), 'localhost/127vaults-server:test']);
await run(engine, ['save', '-o', join(destination, 'postgres-image.tar'), 'docker.io/library/postgres:17-bookworm']);
await run(engine, ['save', '-o', join(destination, 'openssl-image.tar'), 'docker.io/alpine/openssl:3.5.4']);
for (const [source, target] of [
  ['deploy/compose.test.yaml', 'compose.test.yaml'],
  ['deploy/compose.smtp.yaml', 'compose.smtp.yaml'],
  ['server.mjs', 'server.mjs'],
  ['deploy/test-install.mjs', 'lib/test-install.mjs'],
  ['scripts/tls.mjs', 'lib/tls.mjs'],
  ['scripts/ops/backup-envelope.mjs', 'lib/backup-envelope.mjs'],
  ['scripts/ops/server-data.mjs', 'lib/server-data.mjs'],
  ['scripts/ops/identity-backup.mjs', 'lib/identity-backup.mjs'],
  ['docs/release/server-test-install.md', 'README.md'],
  ['LICENSE-POLICY.md', 'LICENSE-POLICY.md']
]) await copyFile(source, join(destination, target));
const revision = await run('git', ['rev-parse', 'HEAD'], { capture: true });
const changed = await run('git', ['status', '--porcelain'], { capture: true });
const files = {};
for (const name of ['server-image.tar', 'postgres-image.tar', 'openssl-image.tar', 'compose.test.yaml', 'compose.smtp.yaml', 'server.mjs', 'lib/test-install.mjs', 'lib/tls.mjs', 'lib/backup-envelope.mjs', 'lib/server-data.mjs', 'lib/identity-backup.mjs', 'README.md', 'LICENSE-POLICY.md']) files[name] = await hash(join(destination, name));
await writeFile(join(destination, 'manifest.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(), revision, sourceDirty: Boolean(changed), image: 'localhost/127vaults-server:test', files }, null, 2) + '\n', { flag: 'wx' });
console.log(`Offline test bundle: ${destination}`);
}

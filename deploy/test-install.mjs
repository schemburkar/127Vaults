// Run from an extracted server test bundle. Never deletes a database volume.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

const action = process.argv[2];
const engine = process.argv.includes('--docker') ? 'docker' : 'podman';
const endpoint = process.argv.find((value, index) => process.argv[index - 1] === '--endpoint') ?? '127.0.0.1';
const restoredIdentity = process.argv.find((value, index) => process.argv[index - 1] === '--restore-identity');
const privateDir = resolve(restoredIdentity ?? process.argv.find((value, index) => process.argv[index - 1] === '--private-dir') ?? join(homedir(), '.127vaults-test'));
const provider = process.argv.find((value, index) => process.argv[index - 1] === '--compose-provider');
if (!['init', 'start', 'status', 'stop', 'bootstrap'].includes(action)) throw Error('Use init, start, status, stop, or bootstrap.');
if (!/^(127\.0\.0\.1|localhost|(?:10|192\.168)\.(?:\d{1,3}\.){2}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.){2})$/.test(endpoint)) throw Error('Use loopback or a private IPv4 endpoint.');

async function run(program, argv, { quiet = false } = {}) {
  const child = spawn(program, argv, { stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true,
    env: { ...process.env, VAULTS_ENGINE: engine } });
  let output = '';
  if (quiet) {
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-1048576); });
    child.stderr.on('data', () => {});
  }
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
  if (code !== 0) throw Error(`${program} operation failed (${code}); inspect the local container logs.`);
  return output.trim();
}
async function verifyBundle() {
  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
  if (manifest.format !== 1 || !manifest.files || typeof manifest.files !== 'object') throw Error('Unknown bundle manifest.');
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!/^[A-Za-z0-9.-]+$/.test(name) || !/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid bundle manifest.');
    const digest = createHash('sha256');
    for await (const bytes of createReadStream(name)) digest.update(bytes);
    if (digest.digest('hex') !== expected) throw Error(`Bundle checksum mismatch: ${name}`);
  }
}
async function networkOctet() {
  const networks = (await run(engine, ['network', 'ls', '-q'], { quiet: true })).split(/\s+/).filter(Boolean);
  const details = networks.length ? await run(engine, ['network', 'inspect', ...networks], { quiet: true }) : '';
  const used = new Set([...details.matchAll(/172\.28\.(\d+)\.0\/24/g)].map(match => Number(match[1])));
  for (let i = 0; i < 160; i++) {
    const candidate = 40 + (randomBytes(1)[0] % 160);
    if (!used.has(candidate)) return candidate;
  }
  throw Error('Could not choose a free private container subnet.');
}
async function runCompose(args, options) {
  const content = await readFile('.env', 'utf8');
  const project = /^VAULTS_PROJECT=(vaults-test-[a-f0-9]{12})$/m.exec(content)?.[1];
  if (!project) throw Error('Installation project identity is missing or invalid.');
  const smtp = /^SMTP_HOST=(.+)$/m.test(content);
  const files = ['-f', 'compose.test.yaml', ...(smtp ? ['-f', 'compose.smtp.yaml'] : [])];
  return provider
    ? run(provider, ['--podman-path', engine, '-p', project, ...files, ...args], options)
    : run(engine, ['compose', '-p', project, ...files, ...args], options);
}
async function initialize() {
  if (existsSync('.env')) throw Error('.env already exists; preserving installation identity.');
  if (privateDir === resolve('.') || privateDir.startsWith(resolve('.') + '\\') || privateDir.startsWith(resolve('.') + '/')) throw Error('Private directory must be outside the bundle.');
  if (restoredIdentity) {
    for (const name of ['ca/ca.crt', 'ca/ca.key', 'live/server.crt', 'live/server.key', 'runtime/token.key', 'runtime/checkpoint.key', 'runtime/postgres-password', 'runtime/readiness-token']) {
      if (!existsSync(join(privateDir, name))) throw Error(`Restored identity is missing ${name}.`);
    }
  } else {
    await run(engine, ['load', '-i', 'openssl-image.tar']);
    await run(process.execPath, ['tls.mjs', 'init', endpoint, privateDir]);
    const runtime = join(privateDir, 'runtime');
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    await mkdir(join(privateDir, 'output'), { recursive: true, mode: 0o700 });
    const databasePassword = randomBytes(32).toString('hex');
    const readinessToken = randomBytes(32).toString('hex');
    for (const [file, value] of [
      ['postgres-password', databasePassword], ['readiness-token', readinessToken],
      ['token.key', randomBytes(32)], ['checkpoint.key', randomBytes(32)]
    ]) {
      const path = join(runtime, file);
      await writeFile(path, value, { flag: 'wx', mode: 0o600 });
      if (process.platform !== 'win32') await chmod(path, 0o600);
    }
  }
  const chosenOctet = await networkOctet();
  const restoredId = restoredIdentity ? (await readFile(join(privateDir, 'installation-id'), 'utf8')).trim() : null;
  if (restoredId && !/^[0-9a-f-]{36}$/.test(restoredId)) throw Error('Restored installation ID is invalid.');
  const env = [
    `VAULTS_PROJECT=vaults-test-${randomBytes(6).toString('hex')}`,
    ...(restoredId ? [`VAULTS_RESTORE_ID=${restoredId}`] : []),
    `VAULTS_BACKEND_SUBNET=172.28.${chosenOctet}.0/24`,
    `VAULTS_SERVER_IP=172.28.${chosenOctet}.2`,
    `VAULTS_DATABASE_IP=172.28.${chosenOctet}.3`,
    `VAULTS_TLS_DIR=${privateDir.replaceAll('\\', '/')}`,
    `VAULTS_ACCESS_MODE=${endpoint === '127.0.0.1' || endpoint === 'localhost' ? 'loopback' : 'private-lan'}`,
    `VAULTS_ENDPOINT_HOST=${endpoint}`,
    `VAULTS_PUBLISH_ADDRESS=${endpoint}`,
    `VAULTS_ALLOW_VIRTUALIZED_SECRET_PERMISSIONS=${process.platform === 'win32' ? '1' : '0'}`,
    ''
  ].join('\n');
  await writeFile('.env', env, { flag: 'wx', mode: 0o600 });
  console.log(restoredIdentity
    ? 'New restore project configured with the existing installation identity. Restore its database before starting the server.'
    : 'Installation identity created. Keep the private directory and its keys backed up separately from the database.');
}

if (action === 'init') { await verifyBundle(); await initialize(); }
else {
  if (!existsSync('.env')) throw Error('Run init first.');
  if (action === 'start') {
    await verifyBundle();
    const content = await readFile('.env', 'utf8');
    if (/^SMTP_HOST=(.+)$/m.test(content)) {
      const dir = /^VAULTS_TLS_DIR=(.+)$/m.exec(content)?.[1];
      if (!dir || !existsSync(join(dir, 'runtime', 'smtp-password'))) throw Error('Configured SMTP requires runtime/smtp-password outside the bundle.');
    }
    await run(engine, ['load', '-i', 'server-image.tar']);
    await run(engine, ['load', '-i', 'postgres-image.tar']);
    const restoreId = /^VAULTS_RESTORE_ID=([0-9a-f-]{36})$/m.exec(content)?.[1];
    if (content.includes('VAULTS_RESTORE_ID=') && !restoreId) throw Error('Malformed restore installation ID.');
    if (restoreId) {
      await runCompose(['up', '-d', 'database']);
      let actual;
      for (let i = 0; i < 20; i++) {
        try { actual = await runCompose(['exec', '-T', 'database', 'psql', '-U', 'vaults', '-d', 'vaults_experimental', '-At', '-c', 'SELECT id FROM vaults.installation WHERE singleton=true'], { quiet: true }); break; }
        catch { await new Promise(done => setTimeout(done, 1000)); }
      }
      if (!actual) throw Error('Restore database is empty or unreadable. Import the matching encrypted backup before starting the server.');
      if (actual !== restoreId) throw Error('Restored database and identity installation IDs differ; server start refused.');
    }
    await runCompose(['up', '-d', '--no-build']);
    console.log(`Open https://${endpoint}:12780 after verifying and trusting the local CA.`);
  } else if (action === 'stop') await runCompose(['down']);
  else if (action === 'status') await runCompose(['ps']);
  else {
    const info = await runCompose(['exec', '-T', 'server', 'node', 'apps/server/src/entry.mjs', 'provision', 'status'], { quiet: true });
    const status = JSON.parse(info);
    if (!status.bootstrapRequired) { console.log('Owner already exists; bootstrap is closed.'); }
    else {
      await runCompose(['exec', '-T', 'server', 'node', 'apps/server/src/entry.mjs', 'provision', 'create-bootstrap-token'], { quiet: true });
      const token = await runCompose(['exec', '-T', 'server', 'cat', '/run/runtime/bootstrap.txt'], { quiet: true });
      console.log(`One-time owner setup code (expires in 60 minutes): ${token}`);
    }
  }
}

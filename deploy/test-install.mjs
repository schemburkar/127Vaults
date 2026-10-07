// Run from an extracted server test bundle. Never deletes a database volume.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installLicenseFiles } from './license-files.mjs';

export async function runTestInstall(argv) {
const action = argv[0];
const engine = argv.includes('--docker') ? 'docker' : 'podman';
const endpoint = argv.find((value, index) => argv[index - 1] === '--endpoint') ?? '127.0.0.1';
const restoredIdentity = argv.find((value, index) => argv[index - 1] === '--restore-identity');
const privateDir = resolve(restoredIdentity ?? argv.find((value, index) => argv[index - 1] === '--private-dir') ?? join(homedir(), '.127vaults-test'));
const provider = argv.find((value, index) => argv[index - 1] === '--compose-provider');
if (!['init', 'start', 'status', 'identify', 'license', 'stop', 'bootstrap', 'restore'].includes(action)) throw Error('Use init, start, status, identify, license, stop, bootstrap, or restore.');
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
    if (!/^(?:lib\/)?[A-Za-z0-9.-]+$/.test(name) || !/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid bundle manifest.');
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
    await run(process.execPath, ['server.mjs', 'tls', 'init', endpoint, privateDir], { env: { ...process.env, VAULTS_ENGINE: engine } });
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

async function restoreDatabase() {
  await verifyBundle();
  const content = await readFile('.env', 'utf8');
  const restoreId = /^VAULTS_RESTORE_ID=([0-9a-f-]{36})$/m.exec(content)?.[1];
  if (!restoreId) throw Error('Initialize a new restore installation first; existing installations cannot be overwritten.');
  const input = argv.find((value, index) => argv[index - 1] === '--input');
  const key = argv.find((value, index) => argv[index - 1] === '--key-file');
  if (!input || !key) throw Error('Restore requires --input <encrypted database backup> and --key-file <backup key>.');
  const temporary = await mkdtemp(join(tmpdir(), '127vaults-restore-'));
  const dump = join(temporary, 'database.dump');
  let databaseStarted = false;
  try {
    await chmod(temporary, 0o700).catch(() => {});
    const metadata = JSON.parse(await run(process.execPath, ['server.mjs', 'envelope', 'open', '--input', input, '--output', dump, '--key-file', key], { quiet: true }));
    if (metadata.serverId !== restoreId || metadata.database !== 'vaults_experimental' || metadata.requiredVersion !== 'schema-3') {
      throw Error('Database backup does not match this restore identity or supported schema.');
    }
    await run(engine, ['load', '-i', 'postgres-image.tar']);
    await runCompose(['up', '-d', 'database']);
    databaseStarted = true;
    let empty = false;
    for (let i = 0; i < 30; i++) {
      try {
        empty = (await runCompose(['exec', '-T', 'database', 'psql', '-U', 'vaults', '-d', 'vaults_experimental', '-At', '-c', "SELECT to_regclass('vaults.schema_version') IS NULL"], { quiet: true })) === 't';
        break;
      } catch { await new Promise(done => setTimeout(done, 1000)); }
    }
    if (!empty) throw Error('Restore target is unreadable or already contains a schema; no database import was attempted.');
    const databaseContainer = await runCompose(['ps', '-q', 'database'], { quiet: true });
    if (!/^[a-f0-9]{12,64}$/.test(databaseContainer)) throw Error('Could not identify the isolated database container.');
    await run(engine, ['cp', dump, `${databaseContainer}:/tmp/database.dump`]);
    try {
      await runCompose(['exec', '-T', 'database', 'pg_restore', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '-U', 'vaults', '-d', 'vaults_experimental', '/tmp/database.dump']);
    } finally {
      await runCompose(['exec', '-T', 'database', 'rm', '-f', '/tmp/database.dump']).catch(() => {});
    }
    const state = await runCompose(['exec', '-T', 'database', 'psql', '-U', 'vaults', '-d', 'vaults_experimental', '-At', '-c', "SELECT i.id::text || ' ' || s.version::text FROM vaults.installation i CROSS JOIN vaults.schema_version s"], { quiet: true });
    if (state !== `${restoreId} 3`) throw Error('Restored database installation or schema differs from the backup metadata.');
    console.log('Database restored into the new project and matched to the restored identity. Run install start, then verify an existing client login and item read.');
  } finally {
    await rm(temporary, { recursive: true, force: true });
    if (databaseStarted) console.log('The new database project and volume were preserved for inspection.');
  }
}

async function installLicense() {
  await verifyBundle();
  const licensePath = argv.find((value, index) => argv[index - 1] === '--file');
  const keysPath = argv.find((value, index) => argv[index - 1] === '--public-keys');
  if (!licensePath || !keysPath) throw Error('License installation requires --file <signed license> and --public-keys <trusted issuer keys>.');
  const currentEnv = await readFile('.env', 'utf8');
  const configuredDir = /^VAULTS_TLS_DIR=(.+)$/m.exec(currentEnv)?.[1];
  if (configuredDir !== privateDir.replaceAll('\\', '/')) throw Error('Private directory does not match this installation.');
  const info = JSON.parse(await runCompose(['exec', '-T', 'server', 'node', 'apps/server/src/entry.mjs', 'provision', 'status'], { quiet: true }));
  const source = await readFile(resolve(licensePath), 'utf8');
  const keySource = await readFile(resolve(keysPath), 'utf8');
  const accepted = await installLicenseFiles({ runtimeDir: join(privateDir, 'runtime'), envPath: '.env',
    installationId: info.installationId, licenseSource: source, keySource });
  console.log(`Signed ${accepted.plan} license sequence ${accepted.sequence} installed for ${info.installationId}. Run install start to activate status.`);
}

if (action === 'init') { await verifyBundle(); await initialize(); }
else {
  if (!existsSync('.env')) throw Error('Run init first.');
  if (action === 'restore') await restoreDatabase();
  else if (action === 'license') await installLicense();
  else if (action === 'start') {
    await verifyBundle();
    const content = await readFile('.env', 'utf8');
    const configuredEndpoint = /^VAULTS_ENDPOINT_HOST=(.+)$/m.exec(content)?.[1];
    if (!configuredEndpoint || (argv.includes('--endpoint') && endpoint !== configuredEndpoint)) throw Error('Start endpoint must match the initialized installation.');
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
    console.log(`Open https://${configuredEndpoint}:12780 after verifying and trusting the local CA.`);
  } else if (action === 'stop') await runCompose(['down']);
  else if (action === 'status') await runCompose(['ps']);
  else if (action === 'identify') {
    const info = await runCompose(['exec', '-T', 'server', 'node', 'apps/server/src/entry.mjs', 'provision', 'status'], { quiet: true });
    const { installationId } = JSON.parse(info);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installationId)) throw Error('Installation ID is unavailable.');
    console.log(`Installation ID: ${installationId}`);
  }
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
}

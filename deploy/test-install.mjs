// Run from an extracted server test bundle. Never deletes a database volume.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { resolve, join } from 'node:path';
import { configureSubscription, installLicenseFiles, installRevocationFile, restoredLicenseEnvironment } from './license-files.mjs';
import { discoverTailscale, discoverTailscaleIdentity, enableTailnetForward, tailscaleIPv4, validServerHostname, verifyHostnameAddress, checkPublication } from './private-network.mjs';

export function restoreBackupSchema(metadata, installationId) {
  if (metadata?.serverId !== installationId || metadata.database !== 'vaults_experimental'
    || !/^schema-(9|10)$/.test(metadata.requiredVersion)) {
    throw Error('Database backup does not match this restore identity or supported schema.');
  }
  return Number(metadata.requiredVersion.slice(7));
}

function readinessProbe({ origin, ca, token, pathname = '/health/ready' }) {
  return new Promise(resolveProbe => {
    const req = request(new URL(pathname, origin), {
      ca, timeout: 2000, headers: token ? { authorization: `Bearer ${token}` } : {},
    }, response => {
      response.resume();
      response.on('end', () => resolveProbe(response.statusCode === 200));
      response.on('error', () => resolveProbe(false));
    });
    req.on('error', () => resolveProbe(false));
    req.on('timeout', () => { req.destroy(); resolveProbe(false); });
    req.end();
  });
}

export async function waitForReadiness({ origin, ca, token, pathname, attempts = 20,
  probe = readinessProbe, pause = () => new Promise(done => setTimeout(done, 1000)) }) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await probe({ origin, ca, token, ...(pathname ? { pathname } : {}) })) return;
    if (attempt + 1 < attempts) await pause();
  }
  throw Error('Server did not become ready over verified HTTPS. Keep the existing identity and data, inspect container status, and rerun install start after resolving the cause.');
}

export function nextSetupStep({ bootstrapRequired, license, seatUsage }, smtpConfigured) {
  if (!license || license.mode === 'unavailable') return 'Next: inspect the signed license files and persistent clock checkpoint.';
  if (license.clockState === 'rollback_detected') return 'Next: correct the host clock; licensed writes remain locked until time catches up.';
  if (license.mode === 'revoked') return 'Next: obtain and install a new signed license for this installation.';
  if (license.mode === 'read-only' || license.mode === 'locked') return 'Next: renew the signed license to restore vault writes.';
  if (!['active', 'read-only', 'locked', 'revoked'].includes(license.mode)) return 'Next: install a signed license for this installation.';
  if (bootstrapRequired) return 'Next: run install bootstrap, then create the first owner in the HTTPS web client.';
  if (!smtpConfigured) return 'Next: configure and verify SMTP before inviting users.';
  if (seatUsage && seatUsage.activeUsers + seatUsage.reservedSeats >= license.maxActiveUsers) {
    return 'Next: request a signed license with a higher user cap before inviting more users.';
  }
  return 'Next: verify backups and invite users from the enrolled owner account.';
}

export function databaseContainerArgs(project) {
  if (!/^vaults-test-[a-f0-9]{12}$/.test(project)) throw Error('Invalid restore project identity.');
  // podman-compose does not support `ps -q <service>`. Both engines expose
  // Compose's project/service labels, which also prevent selecting another DB.
  return ['ps', '--filter', `label=com.docker.compose.project=${project}`,
    '--filter', 'label=com.docker.compose.service=database', '--format', '{{.ID}}'];
}

export function installationPrivateDirectory(argv, configuration = '') {
  const configured = /^VAULTS_TLS_DIR=(.+)\r?$/m.exec(configuration)?.[1]?.trim();
  const supplied = argv.find((value,index) => argv[index-1] === '--restore-identity')
    ?? argv.find((value,index) => argv[index-1] === '--private-dir');
  if (configured && supplied && resolve(configured) !== resolve(supplied)) {
    throw Error('Private directory does not match the existing installation.');
  }
  return resolve(supplied ?? configured ?? join(homedir(), '.127vaults-test'));
}

export async function runTestInstall(argv) {
const action = argv[0];
const engine = argv.includes('--docker') ? 'docker' : 'podman';
const useTailscale = argv.includes('--tailscale');
const tailnet = useTailscale ? await discoverTailscaleIdentity() : null;
const networkAddress = argv.find((value, index) => argv[index - 1] === '--endpoint') ?? tailnet?.address ?? '127.0.0.1';
const hostname = argv.find((value, index) => argv[index - 1] === '--hostname');
const endpoint = hostname ?? tailnet?.hostname ?? networkAddress;
const restoredIdentity = argv.find((value, index) => argv[index - 1] === '--restore-identity');
const configuration = await readFile('.env','utf8').catch(error => { if(error.code === 'ENOENT') return ''; throw error; });
const privateDir = installationPrivateDirectory(argv, configuration);
const provider = argv.find((value, index) => argv[index - 1] === '--compose-provider');
if (!['init', 'start', 'status', 'identify', 'license', 'revoke', 'stop', 'bootstrap', 'restore'].includes(action)) throw Error('Use init, start, status, identify, license, revoke, stop, bootstrap, or restore.');
const [endpointA, endpointB] = networkAddress.split('.').map(Number);
if (!['127.0.0.1', 'localhost'].includes(networkAddress) && !(isIP(networkAddress) === 4 &&
  (endpointA === 10 || (endpointA === 192 && endpointB === 168) || (endpointA === 172 && endpointB >= 16 && endpointB <= 31))) && !(useTailscale && tailscaleIPv4(networkAddress))) throw Error('Use loopback, a private IPv4 endpoint, or discovered Tailscale with --tailscale.');
if (hostname && (!validServerHostname(hostname) || ['127.0.0.1', 'localhost'].includes(networkAddress))) throw Error('Custom hostnames require an explicit private LAN address or Tailscale. Keep localhost for same-device installations.');

async function run(program, argv, { quiet = false } = {}) {
  const child = spawn(program, argv, { stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true,
    env: { ...process.env, VAULTS_ENGINE: engine,
      ...(engine === 'podman' && provider ? { PODMAN_COMPOSE_PROVIDER: provider } : {}) } });
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
  const files = ['-f', 'compose.test.yaml', ...(smtp ? ['-f', 'compose.smtp.yaml'] : []),
    ...(/^VAULTS_LOCAL_ADMIN=1\r?$/m.test(content) ? ['-f', 'compose.local-admin.yaml'] : [])];
  return run(engine, ['compose', '-p', project, ...files, ...args], options);
}
async function initialize() {
  if (existsSync('.env')) throw Error('.env already exists; preserving installation identity.');
  if (useTailscale && await discoverTailscale() !== networkAddress) throw Error('Endpoint does not match this online Tailscale device.');
  if (validServerHostname(endpoint)) await verifyHostnameAddress(endpoint, networkAddress);
  // Restoring an explicit existing identity does not create replacement keys.
  // Its publication is checked when that restored project is started; isolated
  // restore rehearsals may intentionally use a different configured port.
  const localAdmin = !restoredIdentity && !['localhost', '127.0.0.1'].includes(networkAddress);
  if (!restoredIdentity) await checkPublication(useTailscale || networkAddress === 'localhost' ? '127.0.0.1' : networkAddress);
  if (localAdmin) await checkPublication('127.0.0.1', 12781);
  if (privateDir === resolve('.') || privateDir.startsWith(resolve('.') + '\\') || privateDir.startsWith(resolve('.') + '/')) throw Error('Private directory must be outside the bundle.');
  if (restoredIdentity) {
    for (const name of ['ca/ca.crt', 'ca/ca.key', 'live/server.crt', 'live/server.key', 'runtime/token.key', 'runtime/checkpoint.key', 'runtime/postgres-password', 'runtime/readiness-token']) {
      if (!existsSync(join(privateDir, name))) throw Error(`Restored identity is missing ${name}.`);
    }
  } else {
    await run(engine, ['load', '-i', 'openssl-image.tar']);
    if (localAdmin && !useTailscale && process.platform === 'win32') {
      try {
        await run(engine, ['run', '--rm', '--publish', `${networkAddress}:12780:12780`,
          '--entrypoint', 'openssl', 'docker.io/alpine/openssl:3.5.4', 'version'], { quiet: true });
      } catch {
        throw Error('The container engine could not publish the selected home-network address. Choose Tailscale or this computer only, or use an engine that can bind that address. No installation identity or license was created.');
      }
    }
    await run(process.execPath, ['server.mjs', 'tls', 'init', endpoint, privateDir, ...(localAdmin ? ['--local-admin'] : [])], { env: { ...process.env, VAULTS_ENGINE: engine } });
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
    ...(localAdmin ? ['VAULTS_LOCAL_ADMIN=1'] : []),
    `VAULTS_PROJECT=vaults-test-${randomBytes(6).toString('hex')}`,
    ...(restoredId ? [`VAULTS_RESTORE_ID=${restoredId}`, ...await restoredLicenseEnvironment({ runtimeDir: join(privateDir,'runtime'), installationId: restoredId })] : []),
    `VAULTS_BACKEND_SUBNET=172.28.${chosenOctet}.0/24`,
    `VAULTS_SERVER_IP=172.28.${chosenOctet}.2`,
    `VAULTS_DATABASE_IP=172.28.${chosenOctet}.3`,
    `VAULTS_RELAY_IP=172.28.${chosenOctet}.4`,
    `VAULTS_TLS_DIR=${privateDir.replaceAll('\\', '/')}`,
    `VAULTS_ACCESS_MODE=${useTailscale ? 'tailscale' : networkAddress === '127.0.0.1' || networkAddress === 'localhost' ? 'loopback' : 'private-lan'}`,
    `VAULTS_ENDPOINT_HOST=${endpoint}`,
    `VAULTS_NETWORK_ADDRESS=${networkAddress}`,
    `VAULTS_PUBLISH_ADDRESS=${useTailscale || networkAddress === 'localhost' ? '127.0.0.1' : networkAddress}`,
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
    const restoreSchema = restoreBackupSchema(metadata, restoreId);
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
    const project = /^VAULTS_PROJECT=(vaults-test-[a-f0-9]{12})$/m.exec(content)?.[1];
    const databaseContainer = await run(engine, databaseContainerArgs(project), { quiet: true });
    if (!/^[a-f0-9]{12,64}$/.test(databaseContainer)) throw Error('Could not identify the isolated database container.');
    await run(engine, ['cp', dump, `${databaseContainer}:/tmp/database.dump`]);
    try {
      await runCompose(['exec', '-T', 'database', 'pg_restore', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '-U', 'vaults', '-d', 'vaults_experimental', '/tmp/database.dump']);
    } finally {
      await runCompose(['exec', '-T', 'database', 'rm', '-f', '/tmp/database.dump']).catch(() => {});
    }
    const state = await runCompose(['exec', '-T', 'database', 'psql', '-U', 'vaults', '-d', 'vaults_experimental', '-At', '-c', "SELECT i.id::text || ' ' || s.version::text FROM vaults.installation i CROSS JOIN vaults.schema_version s"], { quiet: true });
    if (state !== `${restoreId} ${restoreSchema}`) throw Error('Restored database installation or schema differs from the backup metadata.');
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
  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
  const pinned = Object.hasOwn(manifest.files, 'issuer-keys.json');
  if (existsSync('issuer-keys.json') && !pinned) throw Error('Unverified issuer key file is present in the bundle.');
  if (!licensePath || (!pinned && !keysPath)) throw Error('License installation requires --file <signed license>; older bundles also require --public-keys <trusted issuer keys>.');
  const currentEnv = await readFile('.env', 'utf8');
  const configuredDir = /^VAULTS_TLS_DIR=(.+)$/m.exec(currentEnv)?.[1];
  if (configuredDir !== privateDir.replaceAll('\\', '/')) throw Error('Private directory does not match this installation.');
  const info = JSON.parse(await runCompose(['exec', '-T', 'server', 'node', 'apps/server/src/entry.mjs', 'provision', 'status'], { quiet: true }));
  const source = await readFile(resolve(licensePath), 'utf8');
  const keySource = await readFile(pinned ? 'issuer-keys.json' : resolve(keysPath), 'utf8');
  if (pinned && keysPath && (await readFile(resolve(keysPath), 'utf8')) !== keySource) throw Error('Supplied issuer keys differ from the bundle-pinned keys.');
  const accepted = await installLicenseFiles({ runtimeDir: join(privateDir, 'runtime'), envPath: '.env',
    installationId: info.installationId, licenseSource: source, keySource });
  console.log(`Signed ${accepted.plan} license sequence ${accepted.sequence} installed for ${info.installationId}. Run install start to activate status.`);
}

async function installRevocation() {
  await verifyBundle();
  const file = argv.find((value, index) => argv[index - 1] === '--file');
  if (!file) throw Error('Revocation installation requires --file <signed revocation>.');
  const content = await readFile('.env', 'utf8');
  if (/^VAULTS_TLS_DIR=(.+)$/m.exec(content)?.[1] !== privateDir.replaceAll('\\', '/')) throw Error('Private directory does not match this installation.');
  const info = JSON.parse(await runCompose(['exec', '-T', 'server', 'node', 'apps/server/src/entry.mjs', 'provision', 'status'], { quiet: true }));
  const accepted = await installRevocationFile({ runtimeDir: join(privateDir, 'runtime'), envPath: '.env',
    installationId: info.installationId, revocationSource: await readFile(resolve(file), 'utf8') });
  console.log(`Signed revocation installed for license ${accepted.licenseId}. Run install start to activate it.`);
}

if (action === 'init') { await verifyBundle(); await initialize(); }
else {
  if (!existsSync('.env')) throw Error('Run init first.');
  if (action === 'restore') await restoreDatabase();
  else if (action === 'license') await installLicense();
  else if (action === 'subscription') {
    await verifyBundle();
    const file = argv.find((value, index) => argv[index - 1] === '--file');
    if (!file) throw Error('Subscription setup requires --file <private subscription.json>.');
    const content = await readFile('.env', 'utf8');
    if (/^VAULTS_TLS_DIR=(.+)$/m.exec(content)?.[1] !== privateDir.replaceAll('\\', '/')) throw Error('Private directory does not match this installation.');
    await configureSubscription({ runtimeDir: join(privateDir, 'runtime'), envPath: '.env', source: await readFile(resolve(file), 'utf8') });
    console.log('Automatic subscription renewal configured. Run install start to activate it.');
  }
  else if (action === 'revoke') await installRevocation();
  else if (action === 'start') {
    await verifyBundle();
    const content = await readFile('.env', 'utf8');
    const configuredEndpoint = /^VAULTS_ENDPOINT_HOST=(.+)$/m.exec(content)?.[1];
    const configuredAddress = /^VAULTS_NETWORK_ADDRESS=(.+)$/m.exec(content)?.[1] ?? configuredEndpoint;
    if (!configuredEndpoint || (argv.includes('--endpoint') && networkAddress !== configuredAddress)
      || (hostname && hostname !== configuredEndpoint)) throw Error('Start endpoint must match the initialized installation.');
    if (/^SMTP_HOST=(.+)$/m.test(content)) {
      const dir = /^VAULTS_TLS_DIR=(.+)$/m.exec(content)?.[1];
      if (!dir || !existsSync(join(dir, 'runtime', 'smtp-password'))) throw Error('Configured SMTP requires runtime/smtp-password outside the bundle.');
    }
    const revocationName = /^VAULTS_LICENSE_REVOCATION_FILE=\/run\/secrets\/runtime\/licenses\/([0-9a-f-]{36}\.revocation\.json)$/m.exec(content)?.[1];
    if (content.includes('VAULTS_LICENSE_REVOCATION_FILE=') && (!revocationName
      || !existsSync(join(privateDir, 'runtime', 'licenses', revocationName)))) {
      throw Error('Configured license revocation file is missing or invalid.');
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
    if (/^VAULTS_ACCESS_MODE=tailscale$/m.test(content)) await enableTailnetForward(configuredAddress);
    const publicationPort = /^VAULTS_PUBLISH_PORT=(\d+)$/m.exec(content)?.[1] || '12780';
    const ca = await readFile(join(privateDir, 'ca/ca.crt'));
    await waitForReadiness({ origin: `https://${configuredEndpoint}:${publicationPort}`, ca,
      token: (await readFile(join(privateDir, 'runtime/readiness-token'), 'utf8')).trim() });
    if (/^VAULTS_LOCAL_ADMIN=1\r?$/m.test(content)) {
      await waitForReadiness({ origin: 'https://127.0.0.1:12781', ca, pathname: '/admin/' });
      console.log('Local administration: https://127.0.0.1:12781/admin/ (on the server computer).');
    }
    console.log(`Open https://${configuredEndpoint}:${publicationPort} after verifying and trusting the local CA.`);
  } else if (action === 'stop') await runCompose(['down']);
  else if (action === 'status') {
    await runCompose(['ps']);
    try {
      const info = JSON.parse(await runCompose(['exec', '-T', 'server', 'node', 'apps/server/src/entry.mjs', 'provision', 'status'], { quiet: true }));
      const content = await readFile('.env', 'utf8');
      const hasLicense = /^VAULTS_LICENSE_FILE=\S+$/m.test(content) && /^VAULTS_LICENSE_PUBLIC_KEYS_FILE=\S+$/m.test(content);
      const hasRevocation = /^VAULTS_LICENSE_REVOCATION_FILE=\S+$/m.test(content);
      const hasSmtp = /^SMTP_HOST=\S+$/m.test(content);
      const license = info.license ?? { mode: 'unavailable' };
      console.log(`Installation ID: ${info.installationId}`);
      console.log(`Signed license configured: ${hasLicense ? 'yes' : 'no'}`);
      console.log(`Signed revocation configured: ${hasRevocation ? 'yes' : 'no'}`);
      console.log(`License state: ${license.mode}${license.plan ? ` (${license.plan})` : ''}`);
      if (license.expiresAt) console.log(`License expires: ${license.expiresAt}`);
      if (license.readOnlyUntil) console.log(`Read-only grace ends: ${license.readOnlyUntil}`);
      if (license.clockState && license.clockState !== 'not_applicable') console.log(`Clock state: ${license.clockState}`);
      if (info.seatUsage) console.log(`Seats: ${info.seatUsage.activeUsers} active, ${info.seatUsage.reservedSeats} reserved${license.maxActiveUsers ? ` / ${license.maxActiveUsers} allowed` : ''}`);
      console.log(`Vault owner enrolled: ${info.bootstrapRequired ? 'no' : 'yes'}`);
      console.log(`Invitation SMTP configured: ${hasSmtp ? 'yes' : 'no'}`);
      console.log(nextSetupStep(info, hasSmtp));
    } catch { console.log('Server setup status is unavailable until the server is running and healthy.'); }
  }
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

import { ensureRuntimeKeys, ensureRuntimeSecret } from './mvp-startup.mjs';
import { runtimeNamespace, assertNamespacePath, assertServerIdentity } from './runtime-namespace.mjs';
import { spawn } from 'node:child_process';
import { access, chmod, mkdir, readFile } from 'node:fs/promises';
import { get as httpsGet } from 'node:https';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const action = process.argv[2] ?? 'up';
const namespace = runtimeNamespace(process.env,{launcher:true});
Object.assign(process.env,namespace.environment);
const project = namespace.project;
const server = `${project}_server_1`;
let credentials = {};
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const scrub = value => {
  let text = String(value);
  for (const secret of Object.values(credentials)) {
    if (!secret) continue;
    text = text.replaceAll(secret, '[redacted]');
    text = text.replaceAll(encodeURIComponent(secret), '[redacted]');
  }
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '[database URL redacted]')
    .replace(/(POSTGRES_PASSWORD|VAULTS_READINESS_TOKEN)=([^\s"'`]+)/g, '$1=[redacted]');
};
function run(executable, args, { optional = false, timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true,
      env: { ...process.env, ...credentials }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    let settled = false;
    let terminationDeadline;
    const collect = chunk => { output = (output + chunk.toString()).slice(-65536); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const finish = callback => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(terminationDeadline);
      callback();
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill();
      terminationDeadline = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(() => reject(new Error(`Command timed out after ${timeout} ms and did not terminate: ${scrub(output).slice(-2500)}`)));
      }, 2000);
    }, timeout);
    child.on('error', () => finish(() => optional ? resolve(null) : reject(new Error('Required command could not start. Check Podman/provider installation.'))));
    child.on('close', code => {
      finish(() => {
        if (timedOut) {
          const message = `Command timed out after ${timeout} ms: ${scrub(output).slice(-2500)}`;
          reject(new Error(message));
        } else if (code === 0) resolve(output.trim());
        else if (optional) resolve(null);
        else reject(new Error(`Command failed (${code ?? 'terminated'}): ${scrub(output).slice(-2500)}`));
      });
    });
  });
}
async function loadCredentials(create) {
  const path = process.env.VAULTS_MVP_ENV_FILE || namespace.serverEnvironment;
  await assertNamespacePath(namespace,path,{owned:true});
  if (!await exists(path)) {
    throw new Error(`No namespace environment found. Run node scripts/namespace.mjs init to preview fresh setup${create ? ', then init --confirm' : ''}. Existing default-path data was preserved.`);
  }
  const found = {};
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match || found[match[1]] !== undefined) throw new Error('Invalid .env; existing configuration was not changed.');
    found[match[1]] = match[2];
  }
  if (!/^[a-f0-9]{64}$/.test(found.POSTGRES_PASSWORD) || !/^[a-f0-9]{64}$/.test(found.VAULTS_READINESS_TOKEN)) throw new Error('Incomplete .env. Set both 64-character lowercase hex credentials.');
  await assertServerIdentity(namespace,found.VAULTS_TLS_DIR);
  if(found.VAULTS_NAMESPACE && found.VAULTS_NAMESPACE!==namespace.name)throw Error('Server namespace mismatch');
  found.VAULTS_PUBLISH_PORT ||= '12880';
  found.VAULTS_NETWORK_PREFIX = '10.127.'+(1+[...namespace.id].reduce((a,c)=>(a*31+c.charCodeAt(0))%250,0));
  const tlsDir = resolve(found.VAULTS_TLS_DIR);
  const fromTemp = relative(resolve(tmpdir()), tlsDir);
  if (!fromTemp || (fromTemp !== '..' && !fromTemp.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(fromTemp)))
    throw new Error('VAULTS_TLS_DIR must be outside the OS temporary directory. Move the complete existing server identity to a persistent private directory and update .env before starting the server.');
  if (process.platform === 'win32') found.VAULTS_ALLOW_VIRTUALIZED_SECRET_PERMISSIONS = '1';
  credentials = found;
}
async function ensureRuntimeSecrets() {
  const runtime = join(credentials.VAULTS_TLS_DIR, 'runtime');
  const output = join(credentials.VAULTS_TLS_DIR, 'output');
  const key = join(runtime, 'token.key');
  const checkpointKey = join(runtime, 'checkpoint.key');
  const databasePassword = join(runtime, 'postgres-password');
  const readinessToken = join(runtime, 'readiness-token');
  await assertNamespacePath(namespace,runtime,{owned:true});
  await assertNamespacePath(namespace,output,{owned:true});
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  await mkdir(output, { recursive: true, mode: 0o700 });
  await ensureRuntimeKeys(runtime);
  await ensureRuntimeSecret(runtime,'postgres-password',credentials.POSTGRES_PASSWORD);
  await ensureRuntimeSecret(runtime,'readiness-token',credentials.VAULTS_READINESS_TOKEN);
  if ((await readFile(key)).length !== 32) throw new Error('Runtime authentication token key must contain exactly 32 bytes.');
  if ((await readFile(checkpointKey)).length !== 32) throw new Error('Runtime checkpoint signing key must contain exactly 32 bytes.');
  if (process.platform !== 'win32') await Promise.all([chmod(runtime, 0o700), chmod(output, 0o700), chmod(key, 0o600), chmod(checkpointKey, 0o600), chmod(databasePassword, 0o600), chmod(readinessToken, 0o600)]);
}
async function engine() {
  const installed = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'RedHat', 'Podman', 'podman.exe') : '';
  const podman = installed && await exists(installed) ? installed : 'podman';
  if (await run(podman, ['--version'], { optional: true, timeout: 10000 }) === null) throw new Error('Podman is required. Install it, then rerun this command.');
  if (await run(podman, ['info', '--format', 'json'], { optional: true, timeout: 15000 }) === null) {
    if (action !== 'up') throw new Error('Podman is not running. Run pnpm dev:up.');
    console.log('Starting the Podman development machine…');
    const machines = JSON.parse(await run(podman, ['machine', 'list', '--format', 'json']));
    if (!machines.length) await run(podman, ['machine', 'init']);
    else if (!machines.some(machine => machine.Name === 'podman-machine-default')) throw new Error('No default Podman machine. Start your chosen machine explicitly, then rerun.');
    await run(podman, ['machine', 'start', 'podman-machine-default']);
  }
  return podman;
}
async function provider(podman) {
  const local = join(root, '.tools', 'compose', process.platform === 'win32' ? 'Scripts/podman-compose.exe' : 'bin/podman-compose');
  if (await exists(local)) return args => run(local, ['--podman-path', podman, '--env-file', process.env.VAULTS_MVP_ENV_FILE || namespace.serverEnvironment, '-p', project, ...args]);
  if (await run(podman, ['compose', 'version'], { optional: true, timeout: 15000 }) === null) throw new Error('A Compose provider is required. Install podman-compose or Docker Compose; see docs/release/experimental-development.md.');
  return args => run(podman, ['compose', '--env-file', process.env.VAULTS_MVP_ENV_FILE || namespace.serverEnvironment, '-p', project, ...args]);
}
async function status(podman) {
  const headers = { authorization: `Bearer ${credentials.VAULTS_READINESS_TOKEN}` };
  for (const [path, auth] of [['live', {}], ['ready', headers]]) {
    let response;
    try {
      const ca = await readFile(join(credentials.VAULTS_TLS_DIR, 'ca', 'ca.crt'));
      response = await new Promise((resolve, reject) => {
        const request = httpsGet({ hostname: credentials.VAULTS_ENDPOINT_HOST ?? '127.0.0.1', port: Number(credentials.VAULTS_PUBLISH_PORT),
          path: `/health/${path}`, headers: auth, ca, timeout: 5000 }, incoming => {
          let data = ''; incoming.on('data', chunk => { data += chunk; });
          incoming.on('end', () => resolve({ status: incoming.statusCode, json: async () => JSON.parse(data) }));
        });
        request.on('timeout', () => request.destroy(new Error('timeout'))); request.on('error', reject);
      });
    }
    catch { throw new Error('Server unreachable at localhost:12780. Run pnpm dev:up and check Podman.'); }
    if (response.status !== 200) throw new Error(`${path} returned HTTP ${response.status}. Check schema compatibility or local credentials; do not reset the database.`);
    const body = await response.json();
    if (body.status !== 'ok' || (path === 'ready' && (body.experimental !== true || body.schemaVersion !== 6))) throw new Error('Unexpected health response; check port ownership and server version.');
    console.log(`${path}: OK`);
  }
  const state = JSON.parse(await run(podman, ['exec', server, 'node', 'apps/server/src/entry.mjs', 'provision', 'status']));
  console.log(`Schema ${state.schemaVersion}; ${state.pending_accounts} account(s). Authentication routes are available.`);
    console.log(`Open https://${credentials.VAULTS_ENDPOINT_HOST ?? '127.0.0.1'}:12780/health/live after installing the local CA.`);
}
async function statusAfterStartup(podman) {
  let last;
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await status(podman); return; }
    catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  throw last;
}
try {
  if (!['up', 'status', 'down'].includes(action)) throw new Error('Usage: node scripts/dev.mjs up|status|down');
  console.log('127Vaults experimental development — disposable data only.');
  await loadCredentials(action === 'up');
  if (action === 'up') await ensureRuntimeSecrets();
  const podman = await engine();
  if (action === 'status') await status(podman);
  else {
    const compose = await provider(podman);
    if (action === 'down') {
      await compose(['down']);
      console.log('Stopped containers. Database volume and .env retained; Podman machine remains running.');
    } else {
      console.log('Building the server image…');
      await run(podman, ['build', '-t', 'localhost/127vaults-server:experimental', '-f', 'apps/server/Dockerfile', '.']);
      console.log('Starting server and PostgreSQL…');
      await compose(['up', '-d', '--no-build', '--force-recreate']);
      console.log('Checking/initializing schema (existing data is never reset)…');
      await run(podman, ['exec', server, 'node', 'apps/server/src/entry.mjs', 'provision', 'initialize']);
      await statusAfterStartup(podman);
    }
  }
} catch (error) {
  console.error(scrub(error.message));
  process.exitCode = 1;
}

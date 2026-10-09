// Isolated backing-store acceptance for CLI trusted-device workflows. Uses only
// a new disposable PostgreSQL container; never reads .env or touches a live DB.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.some(value => !['--docker', '--rust'].includes(value)) || new Set(args).size !== args.length) throw Error('Use node scripts/device-management-smoke.mjs [--docker] [--rust].');
const engine = args.includes('--docker') ? 'docker' : 'podman';
const name = `vaults-device-check-${randomUUID()}`;
const root = resolve(import.meta.dirname, '..');
const fixturePassword = 'device-fixture-only-not-a-secret';

async function run(program, argv, { capture = true, env = process.env, timeoutMs = 30000 } = {}) {
  const child = spawn(program, argv, { cwd: root, windowsHide: true, env,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  let output = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', bytes => { output = (output + bytes).slice(-65536); });
  child.stderr?.resume();
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  try {
    const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
    if (code !== 0) throw Error(`${program} check failed (${code}); no existing installation was modified.`);
    return output.trim();
  } finally { clearTimeout(timer); }
}

let created = false;
let certificateDir;
try {
  const integration = {};
  if (args.includes('--rust')) {
    console.log('Compiling the Rust CLI test binary for the live HTTPS device ceremony.');
    const build = await run('cargo', ['test', '--locked', '-p', 'vaults-cli', '--lib', '--no-run', '--message-format=json'], { timeoutMs: 180000 });
    const binary = build.split(/\r?\n/).map(line => { try { return JSON.parse(line); } catch { return null; } })
      .find(value => value?.reason === 'compiler-artifact' && value.profile?.test && value.executable)?.executable;
    if (!binary) throw Error('Rust build did not report a CLI library test executable.');
    certificateDir = await mkdtemp(join(tmpdir(), '127vaults-device-tls-'));
    await chmod(certificateDir, 0o700);
    const openssl = argv => run(engine, ['run', '--rm', '--name', `${name}-tls`, '--pull=never', '--network', 'none',
      '--volume', `${certificateDir.replaceAll('\\', '/')}:/output`, 'docker.io/alpine/openssl:3.5.4', ...argv]);
    await openssl(['req', '-x509', '-newkey', 'rsa:2048', '-noenc', '-sha256', '-days', '1',
      '-subj', '/CN=127Vaults disposable device CA', '-addext', 'basicConstraints=critical,CA:TRUE',
      '-keyout', '/output/ca-key.pem', '-out', '/output/ca.pem']);
    await openssl(['req', '-new', '-newkey', 'rsa:2048', '-noenc', '-sha256', '-subj', '/CN=127Vaults disposable device test',
      '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:FALSE',
      '-keyout', '/output/key.pem', '-out', '/output/server.csr']);
    await openssl(['x509', '-req', '-in', '/output/server.csr', '-CA', '/output/ca.pem', '-CAkey', '/output/ca-key.pem',
      '-set_serial', '1', '-days', '1', '-sha256', '-copy_extensions', 'copy', '-out', '/output/cert.pem']);
    Object.assign(integration, { VAULTS_DEVICE_TEST_BINARY: binary,
      VAULTS_DEVICE_TEST_CERT: join(certificateDir, 'cert.pem'), VAULTS_DEVICE_TEST_KEY: join(certificateDir, 'key.pem'),
      VAULTS_DEVICE_TEST_CA: join(certificateDir, 'ca.pem') });
  }
  // No pull, persistent volume, Compose project, or externally published address.
  await run(engine, ['run', '--rm', '--detach', '--name', name, '--pull=never',
    '--env', 'POSTGRES_PASSWORD', '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=256m', '--memory', '512m',
    'docker.io/library/postgres:17-bookworm'], { env: { ...process.env, POSTGRES_PASSWORD: fixturePassword } });
  created = true;
  const port = /^127\.0\.0\.1:(\d+)$/m.exec(await run(engine, ['port', name, '5432/tcp']))?.[1];
  if (!port) throw Error('Disposable database did not publish an exclusive loopback port.');
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await run(engine, ['exec', name, 'pg_isready', '-U', 'postgres']); ready = true; break; }
    catch { await new Promise(done => setTimeout(done, 500)); }
  }
  if (!ready) throw Error('Disposable PostgreSQL did not become ready.');
  console.log('Running device-management acceptance against an isolated PostgreSQL 17 fixture.');
  await run(process.execPath, ['--test', 'apps/server/test/device-management.pg.test.mjs'], {
    capture: false, env: { ...process.env, ...integration, VAULTS_DEVICE_TEST_DATABASE_URL: `postgresql://postgres:${fixturePassword}@127.0.0.1:${port}/postgres` }
  });
  console.log('Device enrollment, approval, account isolation, revocation, sessions and audit acceptance passed.');
} finally {
  try {
    if (created) {
      await run(engine, ['rm', '--force', name]);
      console.log('Removed the disposable database container and its in-memory data.');
    }
  } finally {
    if (certificateDir) {
      if (dirname(resolve(certificateDir)) !== resolve(tmpdir()) || !basename(certificateDir).startsWith('127vaults-device-tls-')) throw Error('Unexpected fixture certificate directory; cleanup refused.');
      await rm(certificateDir, { recursive: true, force: true });
    }
  }
}

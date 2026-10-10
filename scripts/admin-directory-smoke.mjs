// Isolated admin-directory acceptance: never reads .env or a live database.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.some(value => value !== '--docker') || args.length > 1) throw Error('Use node scripts/admin-directory-smoke.mjs [--docker].');
const engine = args.includes('--docker') ? 'docker' : 'podman';
const name = `vaults-admin-check-${randomUUID()}`;
const root = resolve(import.meta.dirname, '..');
const fixturePassword = 'admin-directory-fixture-only-not-a-secret';
async function run(program, argv, { capture = true, env = process.env } = {}) {
  const child = spawn(program, argv, { cwd: root, windowsHide: true, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  let output = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', chunk => { output = (output + chunk).slice(-65536); });
  child.stderr?.resume();
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  try {
    const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
    if (code !== 0) throw Error(`${program} admin fixture check failed (${code}). No existing installation was modified.`);
    return output.trim();
  } finally { clearTimeout(timer); }
}
let created = false;
try {
  await run(engine, ['run', '--rm', '--detach', '--name', name, '--pull=never', '--env', 'POSTGRES_PASSWORD',
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,size=256m', '--memory', '512m', 'docker.io/library/postgres:17-bookworm'],
  { env: { ...process.env, POSTGRES_PASSWORD: fixturePassword } });
  created = true;
  const port = /^127\.0\.0\.1:(\d+)$/m.exec(await run(engine, ['port', name, '5432/tcp']))?.[1];
  if (!port) throw Error('Fixture must have an exclusive loopback port.');
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await run(engine, ['exec', name, 'pg_isready', '-U', 'postgres']); ready = true; break; }
    catch { await new Promise(done => setTimeout(done, 500)); }
  }
  if (!ready) throw Error('Disposable PostgreSQL did not become ready.');
  console.log('Checking admin directories against isolated PostgreSQL 17.');
  await run(process.execPath, ['--test', 'apps/server/test/admin-directory.pg.test.mjs'], {
    capture: false, env: { ...process.env, VAULTS_ADMIN_TEST_DATABASE_URL: `postgresql://postgres:${fixturePassword}@127.0.0.1:${port}/postgres` },
  });
} finally {
  if (created) { await run(engine, ['rm', '--force', name]); console.log('Removed the disposable admin database and its in-memory data.'); }
}

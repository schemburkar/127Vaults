// Rehearse an extracted release using only fictitious identities and new projects.
// Existing installations and volumes are never stopped, reset or deleted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { request } from 'node:https';
import { connect } from 'node:net';
import { verify } from '../deploy/install.mjs';

const root = resolve(import.meta.dirname, '..');
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i], value = process.argv[i + 1];
  if (!['--bundle', '--work', '--compose-provider', '--port'].includes(name) || !value || options[name]) throw Error('Use --bundle <server tar> --work <new external directory> --compose-provider <path> [--port <free loopback port>].');
  options[name] = value;
}
if (!options['--bundle'] || !options['--work'] || !options['--compose-provider']) throw Error('Bundle, workspace and Compose provider are required.');
const work = resolve(options['--work']), archive = resolve(options['--bundle']);
const rel = relative(root, work);
if (!rel || !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) throw Error('Fixture workspace must be outside the checkout.');
const port = Number(options['--port'] || '12890');
if (!/^\d+$/.test(String(port)) || !Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('Use an unprivileged valid port.');
const inUse = await new Promise(done => {
  const socket = connect({ host: '127.0.0.1', port });
  socket.setTimeout(1000);
  socket.on('connect', () => { socket.destroy(); done(true); });
  socket.on('error', () => done(false));
  socket.on('timeout', () => { socket.destroy(); done(true); });
});
if (inUse) throw Error('Fixture port is in use; existing listener was preserved.');
await mkdir(work); // Never reuse a previous installation or test volume.
const environment = { ...process.env };
delete environment.VAULTS_ADMIN_SETUP_PASSWORD;
async function run(args, cwd = root, env = environment, program = process.execPath) {
  const child = spawn(program, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8'); child.stdout.on('data', value => { output = (output + value).slice(-1024 * 1024); });
  child.stderr.resume(); // Never echo operator output, credentials or backup contents.
  const timer = setTimeout(() => child.kill(), 180000);
  try {
    const code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
    if (code !== 0) throw Error(`${program === process.execPath ? 'Node fixture operation' : program} failed (${code}); fixture files and volumes are retained for inspection.`);
    return output.trim();
  } finally { clearTimeout(timer); }
}
const projects = [];
let ca;
const origin = `https://127.0.0.1:${port}`;
async function http(path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((done, reject) => {
    const req = request(origin + path, { method, ca, headers: { ...(body ? { 'content-type': 'application/json', origin } : {}), ...headers }, timeout: 5000 }, res => {
      let data = ''; res.setEncoding('utf8'); res.on('data', bytes => { data += bytes; });
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(Error('Fixture HTTPS timeout')));
    req.end(body && JSON.stringify(body));
  });
}
async function ready() {
  for (let i = 0; i < 30; i++) {
    try { if ((await http('/health/live')).status === 200) return; } catch {}
    await new Promise(done => setTimeout(done, 1000));
  }
  throw Error('Fixture did not become HTTPS ready.');
}
const operator = (directory, args, env = environment) => run(['server.mjs', ...args], directory, env);
const provider = ['--compose-provider', resolve(options['--compose-provider'])];
async function fixturePort(directory) {
  const path = join(directory, 'compose.test.yaml');
  const original = await readFile(path, 'utf8');
  assert.ok(original.includes(':12780') && original.includes("      VAULTS_EXPERIMENTAL: '1'"));
  const content = original.replaceAll(':12780', `:${port}`).replace("      VAULTS_EXPERIMENTAL: '1'", `      PORT: '${port}'\n      VAULTS_EXPERIMENTAL: '1'`);
  await writeFile(path, content);
  const envPath = join(directory, '.env');
  await writeFile(envPath, (await readFile(envPath, 'utf8')) + `VAULTS_PUBLISH_PORT=${port}\n`);
  const manifestPath = join(directory, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files['compose.test.yaml'] = createHash('sha256').update(content).digest('hex');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  // This explicit fixture-only port override avoids changing existing listeners.
  await verify(directory);
}
const checks = [];
async function check(name, action) {
  console.log(`Checking internal server ${name}...`);
  await action(); checks.push({ name, status: 'passed' });
}
try {
  const extracted = join(work, 'extracted'); await mkdir(extracted);
  await run(['-xf', archive, '-C', extracted], root, environment, 'tar');
  const names = await readdir(extracted);
  assert.equal(names.length, 1); assert.match(names[0], /^127vaults-server-[A-Za-z0-9.-]+$/);
  const source = join(extracted, names[0]); await verify(source);
  const pristine = join(work, 'restore-bundle'); await cp(source, pristine, { recursive: true });
  const identity = join(work, 'identity');
  await check('fresh identity and packaged admin setup', async () => {
    await operator(source, ['install', 'init', '--endpoint', '127.0.0.1', '--private-dir', identity]);
    await operator(source, ['admin', 'init', 'localowner', join(identity, 'runtime/admin-operators.json')], { ...environment, VAULTS_ADMIN_SETUP_PASSWORD: 'synthetic-internal-admin-password' });
    await fixturePort(source);
    ca = await readFile(join(identity, 'ca/ca.crt'));
  });
  projects.push(source);
  await check('verified HTTPS startup', async () => { await operator(source, ['install', 'start', ...provider]); await ready(); });
  const caPath = join(identity, 'ca/ca.crt'), trusted = { ...environment, NODE_EXTRA_CA_CERTS: caPath };
  const bootstrapPath = join(work, 'bootstrap.txt');
  await check('owner and encrypted-item hostile paths', async () => {
    const bootstrap = await operator(source, ['install', 'bootstrap', ...provider]);
    const token = /127V-B1-[A-Za-z0-9_-]{43}/.exec(bootstrap)?.[0]; assert.ok(token);
    await writeFile(bootstrapPath, token, { mode: 0o600, flag: 'wx' });
    const result = JSON.parse(await run(['scripts/live-mvp-acceptance.mjs', origin, caPath, bootstrapPath], root, trusted));
    assert.equal(result.ok, true);
    await run(['scripts/live-transport-acceptance.mjs', origin, caPath], root, trusted);
  });
  await check('packaged admin sign-in, audited writes, replay and sign-out', async () => {
    const login = await http('/api/admin/session', { method: 'POST', body: { username: 'localowner', password: 'synthetic-internal-admin-password' } });
    assert.equal(login.status, 200);
    const session = JSON.parse(login.data), cookie = login.headers['set-cookie'][0].split(';')[0];
    assert.equal(session.managementEnabled, true);
    assert.equal((await http('/api/admin/users', { headers: { cookie } })).status, 200);
    assert.equal((await http('/api/admin/users')).status, 401);
    const headers = { cookie, origin, 'x-127v-admin-csrf': session.csrf };
    const create = { action: 'invitation.create', requestId: randomUUID(), emails: ['packaged-management@example.invalid'], expiresInHours: 24, password: 'synthetic-internal-admin-password' };
    const created = await http('/api/admin/actions', { method: 'POST', headers, body: create });
    assert.equal(created.status, 200);
    const invitation = JSON.parse(created.data);
    assert.match(invitation.token, /^127V-I1-/);
    assert.deepEqual(JSON.parse((await http('/api/admin/actions', { method: 'POST', headers, body: create })).data), invitation);
    const divergent = await http('/api/admin/actions', { method: 'POST', headers, body: { ...create, expiresInHours: 48 } });
    assert.equal(divergent.status, 409);
    assert.equal((await http('/api/admin/actions', { method: 'POST', headers, body: { action: 'invitation.revoke', requestId: randomUUID(), targetId: invitation.invitationId, password: create.password } })).status, 200);
    const audit = await http('/api/admin/audit', { headers });
    assert.equal(audit.status, 200);
    assert.ok(audit.data.includes('invitation.create') && audit.data.includes('invitation.revoke'));
    assert.ok(!audit.data.includes(invitation.token) && !audit.data.includes(create.password));
    const logout = await http('/api/admin/session', { method: 'DELETE', headers: { cookie, origin, 'x-127v-admin-csrf': session.csrf } });
    assert.equal(logout.status, 200); assert.equal((await http('/api/admin/users', { headers: { cookie } })).status, 401);
  });
  const id = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/.exec(await operator(source, ['install', 'identify', ...provider]))?.[0]; assert.ok(id);
  const project = /^VAULTS_PROJECT=(.+)$/m.exec(await readFile(join(source, '.env'), 'utf8'))?.[1]; assert.match(project, /^vaults-test-[a-f0-9]{12}$/);
  const databaseKey = join(work, 'database.key'), identityKey = join(work, 'identity.key');
  await writeFile(databaseKey, randomBytes(32), { flag: 'wx', mode: 0o600 });
  await writeFile(identityKey, randomBytes(32), { flag: 'wx', mode: 0o600 });
  const databaseBackup = join(work, 'database.127vbak'), identityBackup = join(work, 'identity.127vbak');
  await check('current-schema encrypted database and identity backup', async () => {
    await operator(source, ['database', 'backup', '--container', `${project}_database_1`, '--output', databaseBackup, '--key-file', databaseKey]);
    await operator(source, ['identity', 'backup', '--private-dir', identity, '--output', identityBackup, '--key-file', identityKey, '--server-id', id]);
    await operator(source, ['database', 'rehearse', '--input', databaseBackup, '--key-file', databaseKey]);
  });
  await operator(source, ['install', 'stop', ...provider]);
  const restoredIdentity = join(work, 'restored-identity');
  await check('guarded combined restore into a new empty project', async () => {
    await operator(pristine, ['identity', 'restore', '--input', identityBackup, '--output-dir', restoredIdentity, '--key-file', identityKey, '--server-id', id]);
    await operator(pristine, ['install', 'init', '--endpoint', '127.0.0.1', '--restore-identity', restoredIdentity]);
    await fixturePort(pristine); projects.push(pristine);
    await operator(pristine, ['install', 'restore', '--input', databaseBackup, '--key-file', databaseKey, ...provider]);
    await assert.rejects(operator(pristine, ['install', 'restore', '--input', databaseBackup, '--key-file', databaseKey, ...provider]));
    await operator(pristine, ['install', 'start', ...provider]); await ready();
    assert.deepEqual(await readFile(join(identity, 'runtime/admin-operators.json')), await readFile(join(restoredIdentity, 'runtime/admin-operators.json')));
  });
  await check('pre-backup owner login and encrypted item read after restore', async () => {
    const result = JSON.parse(await run(['scripts/ops/restored-owner-smoke.mjs', origin], root, trusted));
    assert.equal(result.ok, true); assert.equal(result.installation, id); assert.ok(result.itemCount > 0);
    assert.equal((await http('/api/admin/session', { method: 'POST', body: { username: 'localowner', password: 'synthetic-internal-admin-password' } })).status, 200);
  });
  await writeFile(join(work, 'evidence.json'), JSON.stringify({ date: new Date().toISOString(), scope: 'Windows Podman isolated fictitious-data server release', status: 'passed', checks,
    fixturePort: port, fixtureOverride: 'PORT and loopback Compose mapping; original listeners preserved', limitations: ['Existing host only; not Docker or unrelated-host acceptance.', 'Broader admin permission and ownership acceptance use the separate PostgreSQL and browser fixtures.'] }, null, 2) + '\n');
  console.log('Internal server backup/restore and packaged admin acceptance passed. Evidence and stopped fixture volumes retained.');
} finally {
  for (const directory of projects.reverse()) await operator(directory, ['install', 'stop', ...provider]).catch(() => {});
}

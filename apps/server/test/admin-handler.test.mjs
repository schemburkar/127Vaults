import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createAdminHandler } from '../src/admin/handler.mjs';
import { hashPassword } from '../src/admin/credentials.mjs';

const password = 'a-long-disposable-operator-password';
const hashed = hashPassword(password);
const operator = { username: 'localowner', role: 'owner', salt: Buffer.from(hashed.salt, 'base64url'), hash: Buffer.from(hashed.hash, 'base64url') };
const queries = [];
const pool = { async query(sql) {
  queries.push(sql);
  if (sql.startsWith('SELECT count(*)::int AS total')) return { rows: [{ total: sql.includes('invitation_records') ? 2 : sql.includes('FROM vaults.accounts') ? 1 : 0 }] };
  if (sql.includes('schema_version')) return { rows: [{ version: 6 }] };
  if (sql.includes('active_users')) return { rows: [{ users: 2, active_users: 2 }] };
  if (sql.includes('AS devices')) return { rows: [{ devices: 1, rotation_required: 1, stale: 0, unknown_protection: 1 }] };
  if (sql.includes('AS pending_invitations')) return { rows: [{ pending_invitations: 1, expired_invitations: 1 }] };
  if (sql.includes('FROM vaults.accounts a')) return { rows: [{ id: 'account', username: 'alice', display_name: 'Alice', email: 'alice@example.invalid', server_role: 'user', enrollment_state: 'active', email_verified: true, created_at: new Date(), device_count: 1 }], rowCount: 1 };
  if (sql.includes('FROM vaults.invitation_records')) return { rows: [{ id: 'invitation', email: 'invitee@example.invalid', created_by: 'alice', status: 'pending' }, { id: 'invitation', email: 'other@example.invalid', created_by: 'alice', status: 'redeemed' }] };
  return { rows: [], rowCount: 0 };
} };
pool.connect = async () => ({ query: (sql, values) => sql.startsWith('SELECT') ? pool.query(sql, values) : Promise.resolve({}), release() {} });
let origin;
const server = createServer(async (req, res) => {
  await createHandler()(req, res);
});
let handler;
function createHandler() { return handler; }
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
origin = base;
handler = createAdminHandler({ pool, operators: [operator], origin, schemaVersion: 6 });
after(() => server.close());

test('admin sign-in is separate, read-only, and CSRF protected', async () => {
  const before = await fetch(`${base}/api/admin/users`);
  assert.equal(before.status, 401);
  assert.equal((await fetch(`${base}/api/admin/invitations`)).status, 401);
  const wrongOrigin = await fetch(`${base}/api/admin/session`, { method: 'POST', headers: { Origin: 'https://evil.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'localowner', password }) });
  assert.equal(wrongOrigin.status, 403);
  const login = await fetch(`${base}/api/admin/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'localowner', password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { csrf, role } = await login.json();
  assert.equal(role, 'owner');
  const overview = await fetch(`${base}/api/admin/overview`, { headers: { Cookie: cookie } });
  const health = await overview.json();
  assert.equal(health.devices.rotationRequired, 1);
  assert.equal(health.invitations.pending, 1);
  const users = await fetch(`${base}/api/admin/users`, { headers: { Cookie: cookie } });
  assert.equal(users.status, 200);
  assert.equal((await users.json()).users[0].username, 'alice');
  assert.equal(users.headers.get('cache-control'), 'no-store');
  const filtered = await fetch(`${base}/api/admin/users?page=2&q=alice&status=active`, { headers: { Cookie: cookie } });
  assert.equal(filtered.status, 200);
  assert.equal((await filtered.json()).page, 1);
  const invalid = await fetch(`${base}/api/admin/users?pageSize=1000`, { headers: { Cookie: cookie } });
  assert.equal(invalid.status, 400);
  const invitations = await fetch(`${base}/api/admin/invitations`, { headers: { Cookie: cookie } });
  assert.equal(invitations.status, 200);
  assert.equal((await invitations.json()).total, 2);
  const inviteWrite = await fetch(`${base}/api/admin/invitations`, { method: 'POST', headers: { Cookie: cookie, Origin: origin } });
  assert.equal(inviteWrite.status, 405);
  const denied = await fetch(`${base}/api/admin/users`, { method: 'POST', headers: { Cookie: cookie, Origin: origin } });
  assert.equal(denied.status, 405);
  const noCsrf = await fetch(`${base}/api/admin/session`, { method: 'DELETE', headers: { Cookie: cookie, Origin: origin } });
  assert.equal(noCsrf.status, 403);
  const logout = await fetch(`${base}/api/admin/session`, { method: 'DELETE', headers: { Cookie: cookie, Origin: origin, 'X-127v-admin-csrf': csrf } });
  assert.equal(logout.status, 200);
  assert.equal((await fetch(`${base}/api/admin/users`, { headers: { Cookie: cookie } })).status, 401);
  assert.ok(queries.some(sql => sql.includes('FROM vaults.accounts a')));
});

test('private-LAN mode blocks the admin surface', async () => {
  const closed = createAdminHandler({ pool, operators: [operator], origin, schemaVersion: 6, localOnly: false });
  const blocked = createServer((req, res) => closed(req, res));
  blocked.listen(0, '127.0.0.1');
  await once(blocked, 'listening');
  const response = await fetch(`http://127.0.0.1:${blocked.address().port}/admin`);
  assert.equal(response.status, 403);
  await new Promise(resolve => blocked.close(resolve));
});

test('operator cooldowns report retry timing and an observed expired cookie cannot revive', async () => {
  let time = Date.now();
  const isolatedHandler = createAdminHandler({ pool, operators: [operator], origin, schemaVersion: 6, now: () => time });
  const isolated = createServer((req, res) => isolatedHandler(req, res));
  isolated.listen(0, '127.0.0.1');
  await once(isolated, 'listening');
  const target = `http://127.0.0.1:${isolated.address().port}`;
  const signIn = value => fetch(`${target}/api/admin/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'localowner', password: value }) });
  try {
    const wrong = await signIn('incorrect-disposable-password');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('retry-after'), '5');
    const blocked = await signIn(password);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '5');
    time += 4999;
    assert.equal((await signIn(password)).headers.get('retry-after'), '1');
    time += 1;
    const login = await signIn(password);
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    time += 30 * 60_000 - 1;
    assert.equal((await fetch(`${target}/api/admin/session`, { headers: { Cookie: cookie } })).status, 200);
    time += 1;
    assert.equal((await fetch(`${target}/api/admin/session`, { headers: { Cookie: cookie } })).status, 401);
    time -= 60_000;
    assert.equal((await fetch(`${target}/api/admin/session`, { headers: { Cookie: cookie } })).status, 401);
  } finally { await new Promise(done => isolated.close(done)); }
});

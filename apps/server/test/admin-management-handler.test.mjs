import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/admin/credentials.mjs';
import { createAdminHandler } from '../src/admin/handler.mjs';
import { AdminManagementError, managementInput } from '../src/admin/management.mjs';
import { createOwnershipHandler } from '../src/ownership-handler.mjs';

test('management HTTP requires an operator, exact origin, CSRF and a fresh password before dispatch', async () => {
  const password = 'synthetic-admin-handler-password', hashed = hashPassword(password);
  const operator = { username: 'localowner', role: 'owner', salt: Buffer.from(hashed.salt, 'base64url'), hash: Buffer.from(hashed.hash, 'base64url') };
  const origin = 'https://admin.example.test', calls = [], denied = [];
  let now = Date.now();
  const management = { async execute(actor, input) { managementInput(input); calls.push({ actor, input }); return { suspended: true }; }, async denied(...args) { denied.push(args); } };
  const handler = createAdminHandler({ pool: {}, operators: [operator], origin, schemaVersion: 7, management, now: () => now });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin, ...headers }, body: JSON.stringify(body) });
  try {
    const body = { action: 'account.suspend', targetId: randomUUID(), requestId: randomUUID(), password };
    assert.equal((await post('/api/admin/actions', body)).status, 401);
    const login = await post('/api/admin/session', { username: operator.username, password });
    const session = await login.json(), cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal(session.managementEnabled, true);
    const headers = { cookie, 'x-127v-admin-csrf': session.csrf };
    assert.equal((await post('/api/admin/actions', body, { ...headers, origin: 'https://evil.example.test' })).status, 403);
    assert.equal((await post('/api/admin/actions', body, { ...headers, 'x-127v-admin-csrf': 'wrong' })).status, 403);
    assert.equal((await post('/api/admin/actions', { ...body, password: 'incorrect' }, headers)).status, 403);
    assert.equal(calls.length, 0);
    now += 6000;
    assert.equal((await post('/api/admin/actions', body, headers)).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].actor.username, 'localowner');
    assert.ok(!Object.hasOwn(calls[0].input, 'password'));
    assert.ok(!JSON.stringify(denied).includes(password));
    assert.equal((await post('/api/admin/actions', { ...body, actor: 'owner' }, headers)).status, 400);
    assert.equal(calls.length, 1);
    const huge = await post('/api/admin/actions', { ...body, padding: 'x'.repeat(9000) }, headers);
    assert.equal(huge.status, 413);
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
});

test('ownership HTTP binds acceptance to the authenticated recipient and rejects stale-auth errors safely', async () => {
  const origin = 'https://vault.example.test', auth = { tenantId: randomUUID(), accountId: randomUUID(), sessionId: randomUUID(), csrf: 'fixture-csrf' };
  let accepted = null, fresh = false;
  const management = { async grants(value) { assert.equal(value, auth); return { grants: [] }; }, async accept(value, input) { assert.equal(value, auth); if (!fresh) throw new AdminManagementError('fresh_auth_required', 403); accepted = input; return { accepted: true, role: 'owner' }; } };
  const handler = createOwnershipHandler(management, async token => { assert.equal(token, 'fixture-token'); return auth; }, origin);
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`, grantId = randomUUID(), requestId = randomUUID();
  const headers = { cookie: '__Host-127v-session=fixture-token', origin, 'content-type': 'application/json', 'x-127v-csrf': auth.csrf };
  const path = `/api/v1/ownership/requests/${grantId}/accept`;
  try {
    assert.equal((await fetch(base + '/api/v1/ownership/requests')).status, 401);
    assert.equal((await fetch(base + path, { method: 'POST', headers, body: JSON.stringify({ requestId }) })).status, 403);
    assert.equal(accepted, null);
    fresh = true;
    assert.equal((await fetch(base + path, { method: 'POST', headers: { ...headers, 'x-127v-csrf': 'bad' }, body: JSON.stringify({ requestId }) })).status, 401);
    assert.equal((await fetch(base + path, { method: 'POST', headers, body: JSON.stringify({ requestId, accountId: randomUUID() }) })).status, 400);
    assert.equal((await fetch(base + path, { method: 'POST', headers, body: JSON.stringify({ requestId }) })).status, 200);
    assert.deepEqual(accepted, { grantId, requestId });
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
});

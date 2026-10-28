import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalSites } from './local.mjs';
import { readLocalMail } from './mail.mjs';
import { encryptionKey, unseal, seal } from '../../apps/public-intake/cloudflare/crypto.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), '127v-portal-')); let local;
  t.after(async () => { await local?.close(); await rm(directory, { recursive: true, force: true }); });
  local = await createLocalSites({ directory });
  const post = (surface, path, body, headers = {}) => local.request(surface, path, { method: 'POST',
    headers: { Origin: local.origins[surface], 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const get = (path, cookie) => local.request('customer', path, { headers: cookie ? { Cookie: cookie } : {} });
  const submit = async email => {
    const response = await post('public', '/api/waitlist', { email, plan: 'personal', requestedSeats: 3, consent: true, organization: '', website: '' }); assert.equal(response.status, 202);
    const inbox = await local.request('admin', '/api/access-admin/requests', { headers: { Authorization: `Bearer ${local.operatorToken}` } });
    return (await inbox.json()).requests.filter(row => row.email === email).at(-1).id;
  };
  const approve = async id => {
    const response = await post('admin', `/api/access-admin/requests/${id}/approve`, { maxUsers: 3 }, { Authorization: `Bearer ${local.operatorToken}` });
    assert.equal(response.status, 200); return response.json();
  };
  const start = async email => {
    const response = await post('customer', '/api/customer/start', { email }); assert.equal(response.status, 202);
    const result = await response.json();
    const messages = await readLocalMail(directory);
    const message = messages.filter(v => v.to === email.trim().toLowerCase()).at(-1);
    return { ...result, code: message?.text.match(/code is (\d{6})/)?.[1] };
  };
  const complete = async challenge => post('customer', '/api/customer/complete', { challengeId: challenge.challengeId, code: challenge.code });
  const restart = async () => { await local.close(); local = await createLocalSites({ directory }); return local; };
  return { local, directory, post, get, submit, approve, start, complete, restart };
}
test('customer email sign-in lists only owned requests, recovers expired invitations, and leaves licensing unchanged', async t => {
  const f = await fixture(t), id = await f.submit('owner@example.com'), other = await f.submit('other@example.com');
  const invite = await f.approve(id); await f.approve(other);
  const key = await encryptionKey((await readFile(join(f.directory, 'intake-key'), 'utf8')).trim(), 'trials');
  const raw = await f.local.database.prepare('SELECT trial FROM access_requests WHERE id = ?').bind(id).first();
  const record = await unseal(raw.trial, key, `trial:${id}`);
  await f.local.database.prepare('UPDATE access_requests SET trial = ? WHERE id = ?').bind(await seal({ ...record, linkExpiresAt: '2020-01-01T00:00:00.000Z' }, key, `trial:${id}`), id).run();
  const old = await f.post('customer', '/api/customer/invitation', { requestId: id, token: invite.link.split('.').at(-1) }); assert.equal(old.status, 401);
  const challenge = await f.start(' OWNER@EXAMPLE.COM '); assert.match(challenge.code, /^\d{6}$/);
  const response = await f.complete(challenge); assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get('set-cookie'); assert.match(cookie, /^__Host-127v-portal=/); assert.ok(cookie.includes('HttpOnly')); assert.ok(!cookie.includes('Domain='));
  const me = await (await f.get('/api/customer/me', cookie)).json(); assert.equal(me.email, 'owner@example.com'); assert.deepEqual(me.requests.map(v => v.id), [id]);
  assert.equal((await f.get(`/api/trials/${id}`, cookie)).status, 200);
  assert.equal((await f.get(`/api/trials/${other}`, cookie)).status, 401);
  const installerResponse = await f.post('customer', '/api/customer/installer-link', { requestId: id }, { Cookie: cookie }); assert.equal(installerResponse.status, 200);
  const installer = await installerResponse.json(); const grant = installer.link.split('.').at(-1);
  const fresh = await f.local.request('customer', `/api/trials/${id}`, { headers: { Authorization: `Bearer ${grant}` } }); assert.equal(fresh.status, 200);
  const installerSession = await f.post('customer', '/api/customer/invitation', { requestId: id, token: grant });
  assert.equal((await (await f.get('/api/customer/me', installerSession.headers.get('set-cookie'))).json()).scope, 'installer');
  assert.equal((await f.post('customer', '/api/customer/installer-link', { requestId: other }, { Cookie: cookie })).status, 404);
  const unchanged = await f.local.database.prepare('SELECT trial FROM access_requests WHERE id = ?').bind(id).first();
  assert.equal((await unseal(unchanged.trial, key, `trial:${id}`)).activatedAt, record.activatedAt);
  assert.equal((await f.complete(challenge)).status, 403);
  const resumed = await f.restart();
  assert.equal((await resumed.request('customer', '/api/customer/me', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await f.post('customer', '/api/customer/logout', {}, { Cookie: cookie })).status, 200);
  assert.equal((await f.get('/api/customer/me', cookie)).status, 401);
  const ledger = await resumed.database.prepare('SELECT payload FROM customer_challenges LIMIT 1').first(); assert.equal(ledger, null);
  const outbox = await readFile(join(f.directory, 'customer-mail.jsonl'), 'utf8'); assert.ok(!outbox.includes(challenge.code)); assert.ok(!outbox.includes('owner@example.com'));
});
test('invitation sessions are request-scoped, rotate with invitations, and never grant admin privileges', async t => {
  const f = await fixture(t), id = await f.submit('same@example.com');
  const invite = await f.approve(id), next = await f.submit('same@example.com'); await f.approve(next);
  const response = await f.post('customer', '/api/customer/invitation', { requestId: id, token: invite.link.split('.').at(-1) }); assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  const me = await (await f.get('/api/customer/me', cookie)).json(); assert.equal(me.scope, 'invitation'); assert.deepEqual(me.requests.map(v => v.id), [id]);
  assert.equal((await f.get(`/api/trials/${next}`, cookie)).status, 401);
  assert.equal((await f.get('/api/access-admin/requests', cookie)).status, 404);
  assert.equal((await f.local.request('admin', '/api/access-admin/requests', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await f.local.request('public', '/api/customer/me', { headers: { Cookie: cookie } })).status, 404);
  const rotated = await f.post('admin', `/api/access-admin/requests/${id}/rotate`, {}, { Authorization: `Bearer ${f.local.operatorToken}` }); assert.equal(rotated.status, 200);
  assert.equal((await f.get(`/api/trials/${id}`, cookie)).status, 401);
  assert.deepEqual((await (await f.get('/api/customer/me', cookie)).json()).requests, []);
});
test('customer verification uses generic responses, bounded guesses, expiry and one-time challenges', async t => {
  const f = await fixture(t); await f.submit('known@example.com');
  const known = await f.start('known@example.com'), unknown = await f.start('unknown@example.com');
  assert.equal(known.message, unknown.message); assert.equal(unknown.code, undefined);
  const wrong = known.code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await f.complete({ ...known, code: wrong })).status, 403);
  assert.equal((await f.complete(known)).status, 403);
  const fresh = await f.start('known@example.com');
  await f.local.database.prepare('UPDATE customer_challenges SET expires_at = 1 WHERE id = ?').bind(fresh.challengeId).run();
  assert.equal((await f.complete(fresh)).status, 403);
  const denied = await f.post('customer', '/api/customer/start', { email: 'known@example.com' }, { Origin: f.local.origins.public }); assert.equal(denied.status, 403);
  assert.equal((await f.local.request('public', '/api/customer/start', { method: 'POST', body: '{}' })).status, 404);
  const concurrent = await f.start('known@example.com');
  const responses = await Promise.all([f.complete(concurrent), f.complete(concurrent)]); assert.deepEqual(responses.map(v => v.status).sort(), [200, 403]);
  const cookie = responses.find(v => v.status === 200).headers.get('set-cookie');
  await f.local.database.prepare('UPDATE customer_sessions SET expires_at = 1').run();
  assert.equal((await f.get('/api/customer/me', cookie)).status, 401);
});

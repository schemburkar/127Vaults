import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, errorMessage, requestAdmin, validResponse } from '../admin/api.js';

const session = { username: 'operator', role: 'owner', csrf: 'a'.repeat(43), expiresAt: '2026-10-10T16:00:00Z' };
const account = { id: 'account', username: 'alice', displayName: 'Alice', email: 'alice@example.invalid', role: 'user', status: 'active', emailVerified: false, deviceCount: 0, createdAt: '2026-10-10T00:00:00Z' };
const page = { users: [account], total: 1, page: 1, pageSize: 25, pageCount: 1, hasPrevious: false, hasNext: false };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('session validation rejects malformed access data and unconfirmed sign-out', () => {
  assert.equal(validResponse('session', 'GET', session), true);
  for (const value of [null, [], {}, { ...session, role: 'user' }, { ...session, expiresAt: 'invalid' }, { ...session, csrf: { toString: null } }]) assert.equal(validResponse('session', 'GET', value), false);
  assert.equal(validResponse('session', 'DELETE', { signedOut: true }), true);
  assert.equal(validResponse('session', 'DELETE', { signedOut: false }), false);
});

test('directory validation prevents malformed rows or old response shapes from crashing rendering', () => {
  assert.equal(validResponse('users?page=1', 'GET', page), true);
  for (const value of [{ users: [account], limited: true }, { ...page, users: [null] }, { ...page, users: [{ ...account, id: null }] }, { ...page, pageCount: 0 }, { ...page, page: 2 }, { ...page, total: -1 }, { ...page, pageSize: 101 }]) assert.equal(validResponse('users', 'GET', value), false);
  assert.equal(validResponse('users', 'GET', { ...page, total: 0, users: [] }), true);
});

test('bad metadata returns an actionable compatibility error while preserving request settings', async () => {
  let captured;
  await assert.rejects(requestAdmin('users', {}, async (url, options) => { captured = { url, options }; return response({ users: [{ id: null }] }); }), { code: 'incompatible_response', status: 200 });
  assert.equal(captured.url, '/api/admin/users');
  assert.equal(captured.options.credentials, 'same-origin');
  assert.equal(captured.options.cache, 'no-store');
  assert.match(errorMessage(new ApiError('incompatible_response')), /console and server versions match/);
});

test('network and non-JSON failures are safe errors with authentication status retained', async () => {
  await assert.rejects(requestAdmin('session', {}, async () => { throw Error('sensitive transport detail'); }), { code: 'network_unavailable' });
  await assert.rejects(requestAdmin('session', {}, async () => new Response('<html>proxy failure</html>', { status: 401 })), { code: 'server_unavailable', status: 401 });
  await assert.rejects(requestAdmin('session', {}, async () => response({ error: 'rate_limited' }, 429)), { code: 'rate_limited', status: 429 });
  assert.doesNotMatch(errorMessage(new ApiError('network_unavailable')), /sensitive/);
});

test('canceling an obsolete request remains an abort rather than a visible server failure', async () => {
  const controller = new AbortController();
  const reason = new DOMException('Obsolete section request', 'AbortError');
  controller.abort(reason);
  await assert.rejects(requestAdmin('users', { signal: controller.signal }, async (_, options) => { assert.equal(options.signal.aborted, true); throw reason; }), error => error === reason);
});

test('sign-out requires a positive confirmation even for an HTTP success response', async () => {
  await assert.rejects(requestAdmin('session', { method: 'DELETE' }, async () => response({})), { code: 'incompatible_response' });
  assert.deepEqual(await requestAdmin('session', { method: 'DELETE', headers: { 'X-127v-admin-csrf': session.csrf } }, async (_, options) => { assert.equal(options.headers['X-127v-admin-csrf'], session.csrf); return response({ signedOut: true }); }), { signedOut: true });
});

test('server cooldowns remain bounded and provide useful retry guidance', async () => {
  const limited = () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'Retry-After': '5' } });
  await assert.rejects(requestAdmin('session', {}, async () => limited()), error => { assert.equal(error.retryAfter, 5); assert.match(errorMessage(error), /short wait ends/); return true; });
  await assert.rejects(requestAdmin('session', {}, async () => new Response('{}', { status: 429, headers: { 'Retry-After': '999999999' } })), error => error.retryAfter === 0);
});

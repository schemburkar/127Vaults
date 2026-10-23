import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteCall } from '../src/http-client.mjs';

test('writes use current CSRF, same-origin credentials and the existing timeout', async () => {
  let token = 'first';
  const requests = [];
  const call = createRemoteCall({ installedApp: false, getCsrf: () => token, send: async (...args) => { requests.push(args); return { ok: true, json: async () => ({ ok: true }) }; } });
  token = 'second';
  assert.deepEqual(await call('/api/item', { method: 'POST', body: { item: 'synthetic' } }), { ok: true });
  assert.equal(requests[0][1].headers['X-127V-CSRF'], 'second');
  assert.equal(requests[0][1].credentials, 'same-origin');
  assert.equal(requests[0][1].body, '{"item":"synthetic"}');
  assert.equal(requests[0][1].signal.aborted, false);
  await call('/api/item', { method: 'POST', body: {}, token: 'explicit' });
  assert.equal(requests[1][1].headers['X-127V-CSRF'], 'explicit');
  await call('/api/item');
  assert.deepEqual(requests[2][1].headers, {});
  assert.equal(requests[2][1].body, undefined);
});

test('offline refusal, transport errors and malformed responses retain distinct classifications', async () => {
  let called = false;
  const offline = createRemoteCall({ installedApp: true, getCsrf: () => '', online: () => false, send: () => { called = true; } });
  await assert.rejects(offline('/api/item'), /SERVER_UNREACHABLE/);
  assert.equal(called, false);
  for (const [name, expected] of [['TimeoutError', 'SERVER_TIMEOUT'], ['TypeError', 'SERVER_UNREACHABLE']]) {
    const call = createRemoteCall({ installedApp: false, getCsrf: () => '', send: async () => { throw Object.assign(Error('synthetic'), { name }); } });
    await assert.rejects(call('/api/item'), new RegExp(expected));
  }
  const invalid = createRemoteCall({ installedApp: false, getCsrf: () => '', send: async () => ({ ok: true, json: async () => { throw Error('invalid JSON'); } }) });
  await assert.rejects(invalid('/api/item'), /INVALID_SERVER_RESPONSE/);
});

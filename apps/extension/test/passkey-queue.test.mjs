import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasskeyQueue } from '../src/passkey-queue.mjs';
import { encode } from '../src/passkeys.mjs';
const message = { id: 'page-request', operation: 'get', options: { challenge: encode(new Uint8Array(32)), rpId: 'example.test' } };
const sender = { tab: { id: 2, url: 'https://example.test/login' }, url: 'https://example.test/login', frameId: 0, documentId: 'document' };
test('ceremonies bind the browser origin, frame and document and expire exactly once', () => {
  let now = 0, timer, replies = [];
  const queue = createPasskeyQueue({ now: () => now, schedule: callback => { timer = callback; return 1; }, cancel: () => {} });
  const id = queue.add(message, sender, value => replies.push(value));
  assert.equal(queue.get(id).origin, 'https://example.test');
  assert.throws(() => queue.add(message, sender, () => {}), /already pending/);
  queue.cancelPage({ ...sender, documentId: 'other' }, message.id);
  assert(queue.get(id));
  now = 120000;
  assert.equal(queue.get(id), null); timer();
  assert.equal(replies.length, 1); assert.match(replies[0].error, /expired/);
  for (const bad of [{ ...sender, frameId: 1 }, { ...sender, url: 'https://evil.test' }, { ...sender, documentLifecycle: 'prerender' }]) assert.throws(() => queue.add(message, bad, () => {}));
});
test('abort, navigation and lock invalidate pending operations', () => {
  const queue = createPasskeyQueue({ schedule: () => 1, cancel: () => {} }), replies = [];
  const callback = reply => replies.push(reply);
  let id = queue.add(message, sender, callback); queue.cancelPage(sender, message.id); assert.equal(queue.get(id), null);
  id = queue.add(message, sender, callback); queue.cancelTab(sender.tab.id); assert.equal(queue.get(id), null);
  id = queue.add(message, sender, callback); queue.cancelAll(); assert.equal(queue.get(id), null);
  assert.equal(replies.length, 3); assert(replies.every(r => r.error && !r.value));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRevocation } from '../src/session-revocation.mjs';
test('connector revocation locks its current UI session, but cannot lock a newer unlock', () => {
  const state = createSessionRevocation();
  assert.equal(state.acceptUnlock(state.beginUnlock(), 1), true);
  assert.equal(state.revoke(1), true);
  state.lock();
  const next = state.beginUnlock();
  assert.equal(state.revoke(1), false);
  assert.equal(state.acceptUnlock(next, 3), true);
  assert.equal(state.revoke(1), false);
  assert.equal(state.revoke(3), true);
});
test('a lock or revocation while unlocking prevents the late result from showing data', () => {
  const state = createSessionRevocation();
  const first = state.beginUnlock();state.lock();
  assert.equal(state.acceptUnlock(first, 2), false);
  const second = state.beginUnlock();state.revoke(4);
  assert.equal(state.acceptUnlock(second, 4), false);
  state.failUnlock(second);
  assert.equal(state.acceptUnlock(state.beginUnlock(), 6), true);
});

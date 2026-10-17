import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperatorSession, validOperatorSession, clearOperatorSession } from '../src/operator-session.mjs';
test('operator cookie expires absolutely after one hour, is signed and rotates with the key', async () => {
  const at = 1792240000000, secret = 'a'.repeat(43);
  const cookie = await createOperatorSession(secret, at);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(cookie, /Path=\/api\/access-admin; Max-Age=3600/);
  assert.equal(await validOperatorSession(cookie, secret, at + 3599999), true);
  assert.equal(await validOperatorSession(cookie, secret, at + 3600000), false);
  assert.equal(await validOperatorSession(cookie, 'b'.repeat(43), at), false);
  assert.equal(await validOperatorSession(cookie.replace(/=\d/, '=0'), secret, at), false);
  assert.equal(await validOperatorSession('', secret, at), false);
  assert.match(clearOperatorSession(), /Max-Age=0/);
});

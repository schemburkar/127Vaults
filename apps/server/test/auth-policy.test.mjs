import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { AuthError, AuthPolicy, decodeField, deviceProofBytes, requireUnsafeRequest, sessionCookie, strictJson, verifyDeviceProof } from '../src/auth-policy.mjs';

const account = { accountId: 'a', deviceId: 'd' };
const policy = now => { const p = new AuthPolicy(Buffer.alloc(32, 7), () => now.value); p.addAccount(account); return p; };

test('success is device/epoch-bound and replay is rejected', () => {
  const now = { value: 1 }; const p = policy(now); const id = p.start(account); p.finishPassword({ attemptId: id, opaqueValid: true }); const session = p.finishDevice({ attemptId: id, deviceValid: true });
  assert.equal(p.authenticate(session.token).accountId, 'a');
  assert.throws(() => p.finishDevice({ attemptId: id, deviceValid: true }), AuthError);
  p.logout(session.token); assert.throws(() => p.authenticate(session.token), AuthError);
});

test('wrong/unknown authentication is generic and consumed once', () => {
  const now = { value: 1 }; const p = policy(now); const wrong = p.start(account); const unknown = p.start({ accountId: 'missing', deviceId: 'd' });
  for (const id of [wrong, unknown]) assert.throws(() => p.finishPassword({ attemptId: id, opaqueValid: false }), error => error instanceof AuthError && error.message === 'Authentication failed.');
  assert.equal(p.snapshot('a').failures, 1);
});

test('attempt and intermediate capabilities are bounded and single-use', () => {
  const now = { value: 1 }; const p = policy(now); const a = p.start(account); p.start(account); assert.throws(() => p.start(account), AuthError);
  const cap = p.finishPassword({ attemptId: a, opaqueValid: true }); p.consumeIntermediate(cap, 'a', a); assert.throws(() => p.consumeIntermediate(cap, 'a', a), AuthError);
});

test('strict parsing, canonical base64url, cookie and CSRF rules', () => {
  const req = { headers: { 'content-type': 'application/json', origin: 'https://127.0.0.1:12780' } };
  assert.deepEqual(strictJson(req, Buffer.from('{"x":1}'), ['x']), { x: 1 });
  assert.throws(() => strictJson(req, Buffer.from('{"x":1,"y":2}'), ['x']), AuthError);
  assert.deepEqual(decodeField(Buffer.alloc(32).toString('base64url'), 32), Buffer.alloc(32));
  assert.throws(() => decodeField('AA==', 1), AuthError);
  requireUnsafeRequest(req, req.headers.origin, 'csrf', 'csrf');
  assert.throws(() => requireUnsafeRequest(req, 'https://evil.test', 'csrf', 'csrf'), AuthError);
  assert.equal(sessionCookie('token'), '__Host-127v-session=token; Secure; HttpOnly; SameSite=Strict; Path=/');
});

test('device proof binds the complete handshake and root response', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const fields = { contextHash: Buffer.alloc(64, 1), transcriptHash: Buffer.alloc(64, 2), installation: Buffer.alloc(16, 3), account: Buffer.alloc(16, 4), device: Buffer.alloc(16, 5), epoch: 1, rootHash: Buffer.alloc(64, 6) };
  const signature = sign(null, deviceProofBytes(fields), privateKey);
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  assert.equal(verifyDeviceProof(raw, signature, fields), true);
  assert.equal(verifyDeviceProof(raw, signature, { ...fields, epoch: 2 }), false);
});

test('concurrent finish has one winner and failure 20 locks', async () => {
  const now = { value: 1 }; const p = policy(now); const id = p.start(account); p.finishPassword({ attemptId: id, opaqueValid: true });
  const results = await Promise.allSettled([Promise.resolve().then(() => p.finishDevice({ attemptId: id, deviceValid: true })), Promise.resolve().then(() => p.finishDevice({ attemptId: id, deviceValid: true }))]);
  assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  for (let i = 0; i < 20; i++) {
    const attempt = p.start(account);
    assert.throws(() => p.finishPassword({ attemptId: attempt, opaqueValid: false }), AuthError);
    const state = p.snapshot('a'); now.value = Math.max(now.value, state.delayedUntil);
  }
  assert.equal(p.snapshot('a').locked, true);
  assert.throws(() => p.start(account), AuthError);
});

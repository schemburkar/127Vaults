import { createHash, randomBytes } from 'node:crypto';
import { AuthError, decodeField, verifyDeviceProof } from './auth-policy.mjs';

const b64 = value => Buffer.from(value).toString('base64url');
const sha512 = value => createHash('sha512').update(value).digest();

/** Coordinates a reviewed OPAQUE adapter with a durable transactional store. */
export class AuthService {
  constructor({ store, opaque, now = () => new Date() }) {
    for (const name of ['serverLoginStart', 'serverLoginFinish', 'rootResponseTag']) if (typeof opaque?.[name] !== 'function') throw new Error('Complete reviewed OPAQUE adapter required.');
    this.store = store; this.opaque = opaque; this.now = now;
  }
  async start({ username, deviceId, request, origin, source }) {
    const requestBytes = decodeField(request, 96);
    const attempt = randomBytes(32); const attemptId = attempt.toString('base64url');
    const material = await this.store.loginMaterial({ username, deviceId, source, now: this.now(), attempt });
    const step = await this.opaque.serverLoginStart({ setup: material.setup, record: material.record, request: requestBytes, binding: { ...material.binding, origin, attempt } });
    const binding = { ...material.binding, origin, attempt };
    await this.store.saveAttempt({ ...material, binding, bindingBytes: step.bindingBytes, request: requestBytes, response: step.message, attempt, state: step.state, transcriptHash: sha512(Buffer.concat([requestBytes, step.message])), now: this.now() });
    return { attemptId, challenge: b64(step.message), binding: b64(step.bindingBytes ?? material.bindingBytes) };
  }
  async finishPassword({ attemptId, finalization }) {
    const attempt = decodeField(attemptId, 32); const finish = decodeField(finalization, 64);
    const pending = await this.store.consumePasswordAttempt({ attempt, now: this.now() });
    let sessionKey;
    try { sessionKey = await this.opaque.serverLoginFinish({ state: pending.state, finalization: finish, binding: pending.binding }); }
    catch { await this.store.recordFailure(pending); throw new AuthError(); }
    try {
      const rootTag = await this.opaque.rootResponseTag({ sessionKey, binding: pending.binding, request: pending.request, response: pending.response, finalization: finish, descriptor: pending.descriptor, envelope: pending.envelope });
      const capability = randomBytes(32);
      await this.store.passwordSucceeded({ pending, capability, rootTag, now: this.now() });
      return { capability: capability.toString('base64url') };
    } finally { if (Buffer.isBuffer(sessionKey)) sessionKey.fill(0); }
  }
  async consumeRoot({ attemptId, capability }) {
    const result = await this.store.consumeRoot({ attempt: decodeField(attemptId, 32), capability: decodeField(capability, 32), now: this.now() });
    return { descriptor: b64(result.descriptor), envelope: b64(result.envelope), tag: b64(result.tag) };
  }
  async finishDevice({ attemptId, signature }) {
    const pending = await this.store.deviceAttempt({ attempt: decodeField(attemptId, 32), now: this.now() });
    const valid = verifyDeviceProof(pending.publicKey, decodeField(signature, 64), pending.proofFields);
    if (!valid) throw new AuthError();
    const token = randomBytes(32), csrf = randomBytes(32);
    const result = await this.store.createSession({ pending, token, csrf, now: this.now() });
    return { token: token.toString('base64url'), csrf: csrf.toString('base64url'), expiresAt: result.expiresAt.toISOString() };
  }
  authenticate(token) { return this.store.authenticate({ token: decodeField(token, 32), now: this.now() }); }
  logout(token) { return this.store.logout({ token: decodeField(token, 32), now: this.now() }); }
}

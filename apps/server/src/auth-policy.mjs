import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { HttpBoundaryError, parseJsonObject } from './http-boundary.mjs';

export const AUTH_BODY_LIMIT = 16 * 1024;
export const AUTH_COOKIE = '__Host-127v-session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ATTEMPT_TTL_MS = 2 * 60 * 1000;
export const INTERMEDIATE_TTL_MS = 60 * 1000;
export const FAILURE_DELAYS = [0, 0, 0, 0, 5, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 3600, 3600, 3600, 3600, 3600];

export function strictJson(req, bytes, allowed) {
  if (bytes.length > AUTH_BODY_LIMIT) throw new AuthError(413);
  try { return parseJsonObject(req, bytes, allowed); }
  catch (error) { if (error instanceof HttpBoundaryError) throw new AuthError(error.status); throw error; }
}

export function decodeField(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value) || value.includes('=')) throw new AuthError(400);
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) throw new AuthError(400);
  return bytes;
}

export function requireUnsafeRequest(req, origin, csrf, sessionCsrf) {
  if (req.headers.origin !== origin || typeof csrf !== 'string' || typeof sessionCsrf !== 'string') throw new AuthError(403);
  const a = Buffer.from(csrf); const b = Buffer.from(sessionCsrf);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AuthError(403);
}

export function sessionCookie(token) {
  return `${AUTH_COOKIE}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/`;
}
export function clearSessionCookie() {
  return `${AUTH_COOKIE}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export function deviceProofBytes({ contextHash, transcriptHash, installation, account, device, epoch, rootHash }) {
  for (const value of [contextHash, transcriptHash, rootHash]) if (!Buffer.isBuffer(value) || value.length !== 64) throw new AuthError(400);
  for (const value of [installation, account, device]) if (!Buffer.isBuffer(value) || value.length !== 16) throw new AuthError(400);
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new AuthError(400);
  const epochBytes = Buffer.alloc(8); epochBytes.writeBigUInt64BE(BigInt(epoch));
  return Buffer.concat([Buffer.from('127Vaults/device-proof/1\0'), contextHash, transcriptHash, installation, account, device, epochBytes, rootHash]);
}

export function verifyDeviceProof(publicKey, signature, fields) {
  if (!Buffer.isBuffer(publicKey) || publicKey.length !== 32 || !Buffer.isBuffer(signature) || signature.length !== 64) return false;
  // RFC 8410 SubjectPublicKeyInfo prefix for a raw Ed25519 public key.
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKey]), format: 'der', type: 'spki' });
  return verify(null, deviceProofBytes(fields), key, signature);
}

export class AuthError extends Error {
  constructor(status = 401, retryAfter = undefined) { super('Authentication failed.'); this.status = status; this.retryAfter = retryAfter; }
}

const digest = (key, purpose, value) => createHmac('sha256', key).update(purpose).update('\0').update(value).digest();
/** In-memory reference policy. Durable adapters must perform consume/reset/session creation in one DB transaction. */
export class AuthPolicy {
  #key; #attempts = new Map(); #sessions = new Map(); #capabilities = new Map(); #accounts = new Map();
  constructor(key = randomBytes(32), now = () => Date.now()) { if (key.length !== 32) throw new Error('Invalid server key.'); this.#key = Buffer.from(key); this.now = now; }
  addAccount({ accountId, deviceId, epoch = 1, active = true }) { this.#accounts.set(accountId, { deviceId, epoch, active, failures: 0, locked: false, delayedUntil: 0 }); }
  start({ accountId, deviceId, attemptId = randomBytes(32) }) {
    this.cleanup();
    const account = this.#accounts.get(accountId);
    if (account && (account.locked || account.delayedUntil > this.now())) throw new AuthError(401, Math.max(1, Math.ceil((account.delayedUntil - this.now()) / 1000)));
    const live = [...this.#attempts.values()].filter(a => !a.consumed && a.expires > this.now());
    const liveForAccount = live.filter(a => a.accountId === accountId && a.deviceId === deviceId).length;
    if (liveForAccount >= 2 || live.length >= 100) throw new AuthError(429, 60);
    const id = Buffer.from(attemptId).toString('base64url');
    if (this.#attempts.has(id)) throw new AuthError();
    this.#attempts.set(id, { accountId, deviceId, expires: this.now() + ATTEMPT_TTL_MS, consumed: false });
    return id;
  }
  finishPassword({ attemptId, opaqueValid }) {
    const attempt = this.#attempts.get(attemptId);
    if (!attempt || attempt.consumed || attempt.expires <= this.now()) throw new AuthError();
    attempt.consumed = true;
    const account = this.#accounts.get(attempt.accountId);
    if (!account || !account.active || account.deviceId !== attempt.deviceId || !opaqueValid) {
      if (account) this.#fail(account);
      throw new AuthError();
    }
    attempt.passwordComplete = true;
    const intermediate = randomBytes(32).toString('base64url');
    this.#capabilities.set(digest(this.#key, 'intermediate', intermediate).toString('hex'), { accountId: attempt.accountId, attemptId, expires: this.now() + INTERMEDIATE_TTL_MS });
    return intermediate;
  }
  finishDevice({ attemptId, deviceValid }) {
    const attempt = this.#attempts.get(attemptId); const account = attempt && this.#accounts.get(attempt.accountId);
    if (!attempt?.passwordComplete || attempt.deviceConsumed || !account || !deviceValid) throw new AuthError();
    attempt.deviceConsumed = true;
    account.failures = 0; account.delayedUntil = 0;
    const token = randomBytes(32).toString('base64url'); const csrf = randomBytes(32).toString('base64url');
    this.#sessions.set(digest(this.#key, 'session', token).toString('hex'), { accountId: attempt.accountId, deviceId: attempt.deviceId, epoch: account.epoch, csrf, expires: this.now() + SESSION_TTL_MS });
    return { token, csrf, expires: this.now() + SESSION_TTL_MS };
  }
  consumeIntermediate(token, accountId, attemptId) {
    const key = digest(this.#key, 'intermediate', token).toString('hex'); const cap = this.#capabilities.get(key); this.#capabilities.delete(key);
    if (!cap || cap.accountId !== accountId || cap.attemptId !== attemptId || cap.expires <= this.now()) throw new AuthError();
  }
  authenticate(token) {
    const row = this.#sessions.get(digest(this.#key, 'session', token).toString('hex')); const account = row && this.#accounts.get(row.accountId);
    if (!row || row.expires <= this.now() || !account?.active || account.epoch !== row.epoch || account.deviceId !== row.deviceId) throw new AuthError();
    return { ...row };
  }
  logout(token) { this.#sessions.delete(digest(this.#key, 'session', token).toString('hex')); }
  #fail(account) { account.failures += 1; if (account.failures >= 20) account.locked = true; else account.delayedUntil = this.now() + FAILURE_DELAYS[account.failures - 1] * 1000; }
  cleanup() { const now = this.now(); for (const [k, v] of this.#attempts) if (v.expires <= now) this.#attempts.delete(k); for (const [k, v] of this.#capabilities) if (v.expires <= now) this.#capabilities.delete(k); for (const [k, v] of this.#sessions) if (v.expires <= now) this.#sessions.delete(k); }
  snapshot(accountId) { const a = this.#accounts.get(accountId); return a && { failures: a.failures, locked: a.locked, delayedUntil: a.delayedUntil }; }
}

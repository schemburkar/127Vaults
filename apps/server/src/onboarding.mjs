import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const BOOTSTRAP_TTL_MS = 60 * 60_000;
export const ATTEMPT_TTL_MS = 10 * 60_000;
export const EMAIL_TTL_MS = 10 * 60_000;
export const TOKEN_BYTES = 32;

export class OnboardingError extends Error {
  constructor(code = 'onboarding_failed', status = 400) { super(code); this.code = code; this.status = status; }
}

const canonicalToken = (prefix, bytes) => `${prefix}${bytes.toString('base64url')}`;
export const newBootstrapToken = () => canonicalToken('127V-B1-', randomBytes(TOKEN_BYTES));
export const newInviteToken = () => canonicalToken('127V-I1-', randomBytes(TOKEN_BYTES));
export function decodeToken(value, prefix) {
  if (typeof value !== 'string' || value.length !== prefix.length + 43 || !value.startsWith(prefix)) throw new OnboardingError();
  const encoded = value.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new OnboardingError();
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.length !== TOKEN_BYTES || bytes.toString('base64url') !== encoded) throw new OnboardingError();
  return bytes;
}
export function tokenDigest(key, purpose, bytes, extra = Buffer.alloc(0)) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Invalid token key.');
  return createHmac('sha256', key).update(purpose, 'ascii').update('\0').update(extra).update(bytes).digest();
}
export function normalizeUsername(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{4,63}$/.test(value)) throw new OnboardingError();
  return { value, key: value.toLowerCase() };
}
export function normalizeEmail(value) {
  if (typeof value !== 'string') throw new OnboardingError();
  const trimmed = value.replace(/^[\x20\t]+|[\x20\t]+$/g, '');
  if (trimmed.length < 3 || trimmed.length > 254 || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(trimmed)) throw new OnboardingError();
  const at = trimmed.lastIndexOf('@');
  return `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}`;
}
export function validateCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OnboardingError();
  const allowed = ['accountId', 'username', 'displayName', 'email', 'deviceId', 'signingPublicKey', 'opaqueRecord', 'wrappedRootDescriptor', 'wrappedRootEnvelope', 'privateDirectory'];
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new OnboardingError();
  const username = normalizeUsername(value.username).value;
  const email = normalizeEmail(value.email);
  if (typeof value.displayName !== 'string' || [...value.displayName].length < 1 || [...value.displayName].length > 128 || /[\u0000-\u001f\u007f]/.test(value.displayName)) throw new OnboardingError();
  for(const id of [value.accountId,value.deviceId])if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new OnboardingError();
  for (const [name, length] of [['signingPublicKey', 32], ['opaqueRecord', 192]]) decodeBinary(value[name], length);
  for (const name of ['wrappedRootDescriptor', 'wrappedRootEnvelope']) decodeBinary(value[name], undefined, name.endsWith('Envelope') ? 16384 : 4096);
  if (value.privateDirectory !== undefined) decodeBinary(value.privateDirectory, 102);
  return { ...value, username, email };
}
function decodeBinary(value, exact, max = exact) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new OnboardingError();
  const bytes = Buffer.from(value, 'base64url');
  if ((exact && bytes.length !== exact) || bytes.length > max || bytes.toString('base64url') !== value) throw new OnboardingError();
  return bytes;
}
export const emailCode = () => {
  // Rejection sampling removes modulo bias while retaining leading zeroes.
  let n; do { n = randomBytes(4).readUInt32BE(); } while (n >= 4_290_000_000);
  return String(n % 100_000_000).padStart(8, '0');
};

/** Orchestration only. The durable store owns all locking and atomicity. */
export class OnboardingService {
  constructor({ store, mailer, tokenKey, now = () => new Date() }) { this.store = store; this.mailer = mailer; this.key = tokenKey; this.now = now; }
  async authorizeRegistration({ accountId, deviceId, token, email, source }) {
    if (![accountId,deviceId].every(id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))) throw new OnboardingError();
    const bootstrap = typeof token === 'string' && token.startsWith('127V-B1-');
    const prefix = bootstrap ? '127V-B1-' : '127V-I1-';
    const digest = tokenDigest(this.key, bootstrap ? 'bootstrap' : 'invite', decodeToken(token,prefix));
    return this.store.authorizeRegistration({ accountId, deviceId, digest, bootstrap, email: bootstrap ? null : normalizeEmail(email), source, now:this.now() });
  }
  async bootstrapOwner({ token, candidate }) {
    const bootstrapDigest = tokenDigest(this.key, 'bootstrap', decodeToken(token, '127V-B1-'));
    return this.store.bootstrapOwner({ bootstrapDigest, candidate: validateCandidate(candidate), now: this.now() });
  }
  async createInvitation({ ownerAccountId, emails, expiresInHours }) {
    if (![24, 48].includes(expiresInHours) || !Array.isArray(emails) || emails.length < 1 || emails.length > 10) throw new OnboardingError();
    const normalized = emails.map(normalizeEmail);
    if (new Set(normalized).size !== normalized.length) throw new OnboardingError();
    const tokenBytes = randomBytes(32); const token = canonicalToken('127V-I1-', tokenBytes);
    const result = await this.store.createInvitation({ ownerAccountId, emails: normalized, expiresInHours, tokenDigest: tokenDigest(this.key, 'invite', tokenBytes), now: this.now(), invitationId: randomUUID() });
    return { ...result, token };
  }
  async beginInvitation({ token, email, candidate, source }) {
    const inviteDigest = tokenDigest(this.key, 'invite', decodeToken(token, '127V-I1-'));
    const normalized = normalizeEmail(email); const checked = validateCandidate(candidate);
    if (normalized !== checked.email) throw new OnboardingError();
    const capabilityBytes = randomBytes(32); const capability = capabilityBytes.toString('base64url');
    const result = await this.store.beginInvitation({ inviteDigest, email: normalized, candidate: checked, source, now: this.now(), attemptId: randomUUID(), capabilityDigest: tokenDigest(this.key, 'attempt', capabilityBytes) });
    return { ...result, capability };
  }
  async sendEmail({ attemptId, capability }) {
    const cap = tokenDigest(this.key, 'attempt', decodeRawCapability(capability)); const code = emailCode();
    const generation = await this.store.stageEmail({ attemptId, capabilityDigest: cap, codeDigestForGeneration: generation => emailDigest(this.key, attemptId, generation, code), now: this.now() });
    try { await this.mailer.sendCode({ to: generation.email, code, expiresMinutes: 10 }); }
    catch { throw new OnboardingError('email_unavailable', 503); }
    return { sent: true };
  }
  async finalizeInvitation({ attemptId, capability, code }) {
    const cap = tokenDigest(this.key, 'attempt', decodeRawCapability(capability));
    if (typeof code !== 'string' || !/^\d{8}$/.test(code)) throw new OnboardingError();
    return this.store.finalizeInvitation({ attemptId, capabilityDigest: cap, codeDigestForGeneration: generation => emailDigest(this.key, attemptId, generation, code), now: this.now() });
  }
}
function decodeRawCapability(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new OnboardingError();
  const bytes = Buffer.from(value, 'base64url'); if (bytes.length !== 32 || bytes.toString('base64url') !== value) throw new OnboardingError(); return bytes;
}
function emailDigest(key, attemptId, generation, code) {
  const n=Buffer.alloc(8); n.writeBigUInt64BE(BigInt(generation));
  const uuid=Buffer.from(attemptId.replaceAll('-',''),'hex');
  if(uuid.length!==16) throw new OnboardingError();
  return tokenDigest(key, 'email', Buffer.from(code, 'ascii'), Buffer.concat([uuid, n]));
}
export function constantDigestEqual(a, b) { return Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.length === b.length && timingSafeEqual(a, b); }

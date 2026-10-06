import { createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const b64 = /^[A-Za-z0-9_-]+$/;
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === expected.slice().sort().join(',');
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fail = () => { throw new Error('invalid_license'); };

export function verifyLicenseFile(file, publicKeys, installationId) {
  if (!uuid.test(installationId) || typeof file !== 'string' || Buffer.byteLength(file) > 8192) fail();
  let envelope;
  try { envelope = JSON.parse(file); } catch { fail(); }
  if (!keys(envelope, ['schemaVersion', 'keyId', 'payload', 'signature']) || envelope.schemaVersion !== 1
    || !/^[A-Za-z0-9_-]{1,40}$/.test(envelope.keyId) || !b64.test(envelope.payload)
    || !b64.test(envelope.signature) || !Object.hasOwn(publicKeys, envelope.keyId)) fail();
  const bytes = Buffer.from(envelope.payload, 'base64url');
  const signature = Buffer.from(envelope.signature, 'base64url');
  if (bytes.toString('base64url') !== envelope.payload || signature.length !== 64
    || signature.toString('base64url') !== envelope.signature) fail();
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); } catch { fail(); }
  if (!keys(payload, ['licenseId', 'installationId', 'plan', 'majorVersion', 'maxActiveUsers', 'issuedAt', 'notBefore', 'expiresAt', 'sequence'])
    || !uuid.test(payload.licenseId) || payload.installationId !== installationId
    || !['personal', 'commercial'].includes(payload.plan)
    || (payload.plan === 'personal' && (!Number.isSafeInteger(payload.majorVersion) || payload.majorVersion < 1))
    || (payload.plan === 'commercial' && payload.majorVersion !== null)
    || !Number.isSafeInteger(payload.maxActiveUsers) || payload.maxActiveUsers < 1 || payload.maxActiveUsers > 100000
    || !Number.isSafeInteger(payload.sequence) || payload.sequence < 1
    || !iso(payload.issuedAt) || !iso(payload.notBefore) || !iso(payload.expiresAt)
    || payload.issuedAt > payload.notBefore || payload.notBefore >= payload.expiresAt) fail();
  let key;
  try { key = createPublicKey(publicKeys[envelope.keyId]); } catch { fail(); }
  if (key.asymmetricKeyType !== 'ed25519'
    || !verify(null, Buffer.concat([Buffer.from('127Vaults license v1\0'), bytes]), key, signature)) fail();
  return { ...payload, keyId: envelope.keyId };
}

export function licenseStatus(license, now = new Date()) {
  if (!license) return { mode: 'experimental', plan: null, maxActiveUsers: null, expiresAt: null, readOnlyUntil: null };
  const at = now.getTime();
  if (!Number.isFinite(at)) fail();
  const start = Date.parse(license.notBefore);
  const expiry = Date.parse(license.expiresAt);
  const grace = expiry + 30 * 24 * 60 * 60 * 1000;
  const mode = at < start ? 'locked' : at < expiry ? 'active' : at < grace ? 'read-only' : 'locked';
  return { mode, plan: license.plan, maxActiveUsers: license.maxActiveUsers,
    expiresAt: license.expiresAt, readOnlyUntil: new Date(grace).toISOString() };
}

export async function loadLicenseStatus({ licenseFile, publicKeyFile, installationId, now = new Date() }) {
  if (!licenseFile && !publicKeyFile) return licenseStatus(null, now);
  if (!licenseFile || !publicKeyFile) fail();
  const [file, keyFile] = await Promise.all([readFile(licenseFile, 'utf8'), readFile(publicKeyFile, 'utf8')]);
  let keys;
  try { keys = JSON.parse(keyFile); } catch { fail(); }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) fail();
  return licenseStatus(verifyLicenseFile(file, keys, installationId), now);
}

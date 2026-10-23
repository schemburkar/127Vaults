// Software authenticator for synced vault credentials. No key leaves the trusted
// extension/source boundary. The website receives only WebAuthn response bytes.
import { PASSKEY_META, PASSKEY_KEY, encode, decode, readMetadata } from './shared/passkey-metadata.mjs';
export { PASSKEY_META, PASSKEY_KEY, encode, decode, readMetadata };
const enc = new TextEncoder();
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let pos = 0; for (const p of parts) { out.set(p, pos); pos += p.length; } return out; };
const digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
// Deliberately exact-host in this first provider version. Parent-domain RPs and
// cross-origin frames fall back to the browser; no public-suffix guessing.
export function validateRequest(kind, options, origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || !url.hostname || url.username || url.password) throw Error('Passkeys require an HTTPS origin.');
  if (!['create', 'get'].includes(kind) || !options || typeof options !== 'object') throw Error('Invalid passkey request.');
  decode(options.challenge, 16, 1024);
  const rpId = kind === 'create' ? options.rp?.id || url.hostname : options.rpId || url.hostname;
  if (rpId !== url.hostname) throw Error('This provider currently supports exact-host relying parties only. Use the browser for this request.');
  const descriptors = kind === 'create' ? options.excludeCredentials : options.allowCredentials;
  if (descriptors !== undefined && (!Array.isArray(descriptors) || descriptors.length > 64)) throw Error('Invalid credential list.');
  for (const value of descriptors || []) { if (value.type !== 'public-key') throw Error('Invalid credential type.'); decode(value.id, 1, 1024); }
  if (options.extensions && Object.entries(options.extensions).some(([key, value]) => kind !== 'create' || key !== 'credProps' || typeof value !== 'boolean')) throw Error('This WebAuthn extension is not supported by this provider. Use the browser.');
  if (kind === 'create') {
    if (!options.pubKeyCredParams?.some(p => p.type === 'public-key' && p.alg === -7)) throw Error('The website must support ES256.');
    if (options.attestation && options.attestation !== 'none') throw Error('Attestation is not supported. Use the browser.');
    decode(options.user?.id, 1, 64);
    for (const name of ['name', 'displayName']) if (typeof options.user?.[name] !== 'string' || options.user[name].length > 256) throw Error('Invalid passkey user.');
  }
  const uv = kind === 'create' ? options.authenticatorSelection?.userVerification : options.userVerification;
  if (uv && !['required', 'preferred', 'discouraged'].includes(uv)) throw Error('Invalid user verification policy.');
  return { rpId, origin };
}
export function matches(meta, options, origin) {
  return meta?.origin === origin && meta.rpId === (options.rpId || new URL(origin).hostname) && (!options.allowCredentials?.length || options.allowCredentials.some(c => c.id === meta.credentialId));
}
// Small canonical CBOR encoder for the fixed ES256 COSE key / none attestation.
function cbor(value) {
  const head = (major, n) => n < 24 ? Uint8Array.of(major * 32 + n) : n < 256 ? Uint8Array.of(major * 32 + 24, n) : Uint8Array.of(major * 32 + 25, n >> 8, n & 255);
  if (typeof value === 'number') return value < 0 ? head(1, -1 - value) : head(0, value);
  if (typeof value === 'string') { const bytes = enc.encode(value); return concat(head(3, bytes.length), bytes); }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  return concat(head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)]));
}
function clientData(kind, options, origin) { return enc.encode(JSON.stringify({ type: `webauthn.${kind}`, challenge: options.challenge, origin, crossOrigin: false })); }
async function authData(rpId, attested) {
  // UP + UV (fresh master-password verification required by the caller), BE.
  // Conservatively keep BS clear: a durable local save is not proof of backup.
  // Synced software credentials use a permanent zero signature counter.
  return concat(await digest(enc.encode(rpId)), Uint8Array.of(attested ? 0x4d : 0x0d), new Uint8Array(4));
}
export async function createPasskey(options, origin, userVerified) {
  const { rpId } = validateRequest('create', options, origin);
  if (userVerified !== true) throw Error('Verify your master password before creating a passkey.');
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateKey = encode(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const credentialId = encode(crypto.getRandomValues(new Uint8Array(32)));
  const metadata = { version: 1, algorithm: -7, rpId, origin, credentialId, userHandle: options.user.id, username: options.user.name, displayName: options.user.displayName, signCount: 0 };
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, decode(publicKey.x, 32, 32)], [-3, decode(publicKey.y, 32, 32)]]));
  const data = concat(await authData(rpId, true), new Uint8Array(16), Uint8Array.of(0, 32), decode(credentialId), cose);
  return { metadata, privateKey, response: { id: credentialId, rawId: credentialId, type: 'public-key', authenticatorAttachment: 'platform', response: { clientDataJSON: encode(clientData('create', options, origin)), attestationObject: encode(cbor({ fmt: 'none', attStmt: {}, authData: data })), authenticatorData: encode(data), publicKey: encode(await crypto.subtle.exportKey('spki', pair.publicKey)), publicKeyAlgorithm: -7, transports: ['internal'] }, clientExtensionResults: options.extensions?.credProps ? { credProps: { rk: true } } : {} } };
}
export function passkeyFields(metadata, privateKey) {
  decode(privateKey, 64, 512);
  const fields = [{ id: '__127vaults_item_type', label: 'Item type', type: 'metadata', value: 'passkey' }, { id: PASSKEY_META, label: 'Passkey', type: 'metadata', value: JSON.stringify(metadata) }, { id: PASSKEY_KEY, label: 'Passkey private key', type: 'password', value: privateKey }];
  readMetadata(fields);
  return fields;
}
function derSignature(raw) {
  if (raw.length !== 64) throw Error('Invalid ECDSA signature.');
  const integer = bytes => { let i = 0; while (i < bytes.length - 1 && bytes[i] === 0) i++; let v = bytes.slice(i); if (v[0] & 128) v = concat(Uint8Array.of(0), v); return concat(Uint8Array.of(2, v.length), v); };
  const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}
export async function assertPasskey(metadata, privateKey, options, origin, userVerified) {
  validateRequest('get', options, origin);
  readMetadata([{ id: PASSKEY_META, type: 'metadata', value: JSON.stringify(metadata) }]);
  if (!matches(metadata, options, origin) || userVerified !== true) throw Error('Passkey does not match or master password was not verified.');
  const bytes = decode(privateKey, 64, 512);
  let key;
  try { key = await crypto.subtle.importKey('pkcs8', bytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); } finally { bytes.fill(0); }
  const data = await authData(metadata.rpId, false), client = clientData('get', options, origin);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, concat(data, await digest(client))));
  return { id: metadata.credentialId, rawId: metadata.credentialId, type: 'public-key', authenticatorAttachment: 'platform', response: { clientDataJSON: encode(client), authenticatorData: encode(data), signature: encode(derSignature(sig)), userHandle: metadata.userHandle }, clientExtensionResults: {} };
}

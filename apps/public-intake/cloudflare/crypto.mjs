// Web Crypto only: no filesystem or Node runtime dependencies in the Worker.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const bytes = value => encoder.encode(value);
export function base64url(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function from64(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
export async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? bytes(value) : value)), b => b.toString(16).padStart(2, '0')).join('');
}
export const token = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = await hash(a), right = await hash(b);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return different === 0;
}
async function derive(hex, purpose, algorithm, usages) {
  if (!/^[a-f0-9]{64}$/i.test(hex ?? '')) throw Error('Invalid encryption key');
  const master = Uint8Array.from(hex.match(/../g), b => parseInt(b, 16));
  const material = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bytes('127Vaults Cloudflare v1'), info: bytes(purpose) },
    material, algorithm, false, usages);
}
export const encryptionKey = (hex, purpose) => derive(hex, purpose, { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']);
export const limiterKey = hex => derive(hex, 'request-limits', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']);
export const limitIdentity = async (key, value) => base64url(await crypto.subtle.sign('HMAC', key, bytes(value)));
export async function seal(value, key, aad) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: bytes(aad) }, key, bytes(JSON.stringify(value)));
  return JSON.stringify({ version: 1, nonce: base64url(nonce), ciphertext: base64url(ciphertext) });
}
export async function unseal(value, key, aad) {
  const envelope = JSON.parse(value);
  if (envelope.version !== 1) throw Error('Invalid record');
  return JSON.parse(decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: from64(envelope.nonce), additionalData: bytes(aad) }, key, from64(envelope.ciphertext))));
}
function pemBytes(pem, label) {
  if (typeof pem !== 'string' || !pem.includes(`-----BEGIN ${label}-----`)) throw Error('Invalid issuer key');
  return from64(pem.replace(`-----BEGIN ${label}-----`, '').replace(`-----END ${label}-----`, '').replace(/\s/g, ''));
}
export async function issuer(privatePem, publicPem) {
  const privateKey = await crypto.subtle.importKey('pkcs8', pemBytes(privatePem, 'PRIVATE KEY'), 'Ed25519', false, ['sign']);
  const publicKey = await crypto.subtle.importKey('spki', pemBytes(publicPem, 'PUBLIC KEY'), 'Ed25519', false, ['verify']);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  if (!await crypto.subtle.verify('Ed25519', publicKey, await crypto.subtle.sign('Ed25519', privateKey, challenge), challenge)) throw Error('Issuer mismatch');
  return privateKey;
}
export async function signEnvelope(privateKey, keyId, domain, payload) {
  const encoded = bytes(JSON.stringify(payload));
  const prefix = bytes(domain + '\0');
  const message = new Uint8Array(prefix.length + encoded.length);
  message.set(prefix); message.set(encoded, prefix.length);
  return JSON.stringify({ schemaVersion: 1, keyId, payload: base64url(encoded),
    signature: base64url(await crypto.subtle.sign('Ed25519', privateKey, message)) }) + '\n';
}

export async function verifyLicenseIssuer(source, keys) {
  try {
    const envelope = JSON.parse(source), payload = from64(envelope.payload);
    if (envelope.schemaVersion !== 1 || !keys[envelope.keyId]) return false;
    const key = await crypto.subtle.importKey('spki', pemBytes(keys[envelope.keyId], 'PUBLIC KEY'), 'Ed25519', false, ['verify']);
    const prefix = bytes('127Vaults license v1\0'), message = new Uint8Array(prefix.length + payload.length);
    message.set(prefix); message.set(payload, prefix.length);
    return await crypto.subtle.verify('Ed25519', key, from64(envelope.signature), message);
  } catch { return false; }
}

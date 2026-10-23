// Pure client-side passkey data helpers. No credential creation, signing, or extension APIs.
export const PASSKEY_META = '__127vaults_passkey';
export const PASSKEY_KEY = '__127vaults_passkey_key';
export const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export function decode(value, min = 1, max = 65536) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil(max * 4 / 3)) throw Error('Invalid passkey bytes.');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  if (bytes.length < min || bytes.length > max || encode(bytes) !== value) throw Error('Invalid passkey bytes.');
  return bytes;
}
export function readMetadata(fields) {
  const rows = fields?.filter(f => f.id === PASSKEY_META) || [];
  if (!rows.length) return null;
  if (rows.length !== 1 || rows[0].type !== 'metadata') throw Error('Invalid passkey metadata.');
  const value = JSON.parse(rows[0].value);
  if (value.version !== 1 || value.algorithm !== -7 || value.signCount !== 0 || typeof value.username !== 'string' || value.username.length > 256 || typeof value.displayName !== 'string' || value.displayName.length > 256) throw Error('Invalid passkey metadata.');
  const url = new URL(value.origin);
  if (url.protocol !== 'https:' || url.origin !== value.origin || value.rpId !== url.hostname) throw Error('Invalid passkey origin.');
  decode(value.credentialId, 32, 32); decode(value.userHandle, 1, 64);
  return value;
}

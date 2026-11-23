const name = '__Secure-127v-operator';
const lifetime = 3600000;
const encoder = new TextEncoder();
async function key(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(`127Vaults operator session v1:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const hex = bytes => [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
export async function createOperatorSession(secret, now, sessions) {
  const expires = now + lifetime;
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${expires}.${nonce}`;
  const signature = hex(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload))));
  await sessions.add(nonce, expires, now);
  return `${name}=${payload}.${signature}; Path=/api/access-admin; Max-Age=3600; HttpOnly; Secure; SameSite=Strict`;
}
async function authenticatedNonce(cookie, secret, now) {
  const value = (cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
  const match = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value ?? '');
  if (!match || Number(match[1]) <= now || Number(match[1]) > now + lifetime) return null;
  const signature = Uint8Array.from(match[3].match(/../g), v => parseInt(v, 16));
  const valid = await crypto.subtle.verify('HMAC', await key(secret), signature, encoder.encode(`${match[1]}.${match[2]}`));
  return valid ? match[2] : null;
}
export async function validOperatorSession(cookie, secret, now, sessions) {
  const nonce = await authenticatedNonce(cookie, secret, now);
  return nonce !== null && await sessions.has(nonce, now);
}
export async function revokeOperatorSession(cookie, secret, now, sessions) {
  const nonce = await authenticatedNonce(cookie, secret, now);
  if (nonce !== null) await sessions.remove(nonce);
}
export function memoryOperatorSessions() {
  const sessions = new Map();
  return {
    add(nonce, expires, now) {
      for (const [id, expiry] of sessions) if (expiry <= now) sessions.delete(id);
      sessions.set(nonce, expires);
    },
    has: (nonce, now) => sessions.get(nonce) > now,
    remove: nonce => sessions.delete(nonce),
  };
}
export const clearOperatorSession = () => `${name}=; Path=/api/access-admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

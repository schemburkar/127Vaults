// Reserved custom fields stay inside existing encrypted bodies. The index's
// favorite flag is derived from the marker, so list and body writes agree.
export const FAVORITE_ID = '__127vaults_favorite';
export const TOTP_ID = '__127vaults_totp';
export const isFavorite = fields => fields?.some(f => f.id === FAVORITE_ID && f.value === 'true') ?? false;
export function setFavorite(fields, favorite) {
  const next = fields.filter(f => f.id !== FAVORITE_ID);
  return favorite ? [...next, { id: FAVORITE_ID, label: 'Favorite', type: 'metadata', value: 'true' }] : next;
}
export function setAuthenticator(fields, value) {
  const next = fields.filter(f => f.id !== TOTP_ID);
  return value.trim() ? [...next, { id: TOTP_ID, label: 'Authenticator secret', type: 'password', value: value.trim() }] : next;
}
export function parseTotp(value) {
  if (value.length > 2048) throw Error('The authenticator setup key is too long.');
  let secret = value.trim(), algorithm = 'SHA-1', digits = 6, period = 30;
  if (/^otpauth:/i.test(secret)) {
    const url = new URL(secret);
    if (url.protocol !== 'otpauth:' || url.hostname !== 'totp') throw Error('Use a TOTP setup URI, not an HOTP counter code.');
    secret = url.searchParams.get('secret') || '';
    const hash = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase();
    algorithm = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }[hash];
    digits = Number(url.searchParams.get('digits') || 6);
    period = Number(url.searchParams.get('period') || 30);
  }
  if (!algorithm || ![6, 8].includes(digits) || !Number.isInteger(period) || period < 15 || period > 120) throw Error('Supported codes use SHA1, SHA256 or SHA512, 6 or 8 digits, and a 15–120 second period.');
  secret = secret.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z2-7]+={0,6}$/.test(secret)) throw Error('Enter a valid Base32 secret or otpauth://totp setup URI.');
  const chars = secret.replace(/=+$/, ''), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  if (secret.includes('=') && (secret.length % 8 !== 0 || secret.length !== Math.ceil(chars.length / 8) * 8)) throw Error('Invalid Base32 padding.');
  let bits = 0, buffer = 0; const bytes = [];
  for (const char of chars) {
    buffer = (buffer << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); }
  }
  if (!bytes.length || (bits && (buffer & ((1 << bits) - 1))) || [1,3,6].includes(chars.length % 8)) throw Error('The Base32 secret is incomplete.');
  if (bytes.length < 10) throw Error('Authenticator secrets must contain at least 80 bits.');
  return { key: new Uint8Array(bytes), algorithm, digits, period };
}
// RFC 6238: WebCrypto HMAC with an unsigned, 64-bit time-step counter.
export async function totp(value, seconds = Math.floor(Date.now() / 1000)) {
  const { key, algorithm, digits, period } = parseTotp(value);
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw Error('Invalid clock.');
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(seconds / period)));
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: algorithm }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counter));
  key.fill(0);
  const offset = digest[digest.length - 1] & 15;
  const number = new DataView(digest.buffer).getUint32(offset) & 0x7fffffff;
  return { code: String(number % 10 ** digits).padStart(digits, '0'), remaining: period - seconds % period, period };
}
// A transparent local heuristic, not a breach lookup or an entropy estimate.
export function passwordIssues(password) {
  if (!password) return [];
  const issues = [];
  if (password.length < 12) issues.push('Short password (under 12 characters)');
  if (/^(.)\1+$/u.test(password) || /^(?:password|qwerty|letmein|welcome|admin|123456|abcdef)/i.test(password)) issues.push('Common or predictable pattern');
  return issues;
}
export function analyzePasswords(items, breached = new Set()) {
  const credentials = items.flatMap(item => [
    ...(item.password ? [{ item, label: 'Password', value: item.password }] : []),
    ...(item.customFields || []).filter(f => f.type === 'password' && f.id !== TOTP_ID && /password/i.test(f.label) && f.value).map(f => ({ item, label: f.label, value: f.value }))
  ]);
  const counts = new Map();
  for (const { item, value } of credentials) {
    const identities = counts.get(value) || new Set(); identities.add(`${item.vaultId || ''}:${item.itemId}`); counts.set(value, identities);
  }
  return credentials.flatMap(({ item, label, value }) => {
    const issues = passwordIssues(value);
    if (breached.has(value)) issues.push('Found in known breaches');
    const count = counts.get(value).size;
    if (count > 1) issues.push(`Reused across ${count} items`);
    return issues.length ? [{ itemId: item.itemId, vaultId: item.vaultId, title: item.title || 'Untitled', website: item.website, label, issues }] : [];
  });
}

export function changePasswordUrl(website) {
  try {
    if (typeof website !== 'string' || !website.trim()) return null;
    const value = website.trim();
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value);
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin + '/.well-known/change-password';
  } catch { return null; }
}
export async function breachedPasswords(items, { signal, request = fetch } = {}) {
  const passwords = [...new Set(items.flatMap(item => [item.password, ...(item.customFields || []).filter(f => f.type === 'password' && f.id !== TOTP_ID && /password/i.test(f.label)).map(f => f.value)]).filter(Boolean))];
  const found = new Set(), ranges = new Map();
  for (const password of passwords) {
    signal?.throwIfAborted();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const prefix = hash.slice(0, 5);
    if (!ranges.has(prefix)) {
      const response = await request('https://api.pwnedpasswords.com/range/' + prefix, { signal, headers: { 'Add-Padding': 'true' }, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw Error('Breach check unavailable');
      const lines = (await response.text()).trim().split(/\r?\n/);
      if (!lines.length || lines.some(line => !/^[A-F0-9]{35}:\d+$/i.test(line))) throw Error('Invalid breach response');
      ranges.set(prefix, new Set(lines.filter(line => Number(line.split(':')[1]) > 0).map(line => line.split(':')[0].toUpperCase())));
    }
    if (ranges.get(prefix).has(hash.slice(5))) found.add(password);
  }
  return found;
}

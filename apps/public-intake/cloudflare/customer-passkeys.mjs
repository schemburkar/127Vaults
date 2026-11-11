import { generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { base64url, from64, hash, token, seal, unseal, limitIdentity } from './crypto.mjs';
import { rawBody, reject } from './dodo.mjs';

const challengeCookie = '__Host-127v-passkey';
const cookie = value => `${challengeCookie}=${value}; Path=/; Max-Age=300; Secure; HttpOnly; SameSite=Strict`;
export const recentAuthentication = (principal, now) => principal?.kind === 'email'
  && Number.isFinite(principal.authenticatedAt) && principal.authenticatedAt <= now
  && now - principal.authenticatedAt < 10 * 60000;
async function input(request, allowed) {
  let value;
  try { value = JSON.parse(await rawBody(request, 32768)); } catch { reject(400, 'invalid_request'); }
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !allowed.includes(key))) reject(400, 'invalid_request');
  return value;
}
function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) reject(400, 'invalid_passkey_name');
  return value.trim();
}
export async function handlePasskeys(request, env, store, now, principal, key, createSession, json) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/customer/passkeys')) return null;
  const origin = env.CUSTOMER_ORIGIN ?? env.PUBLIC_INTAKE_ORIGIN;
  const rpID = new URL(origin).hostname;
  const account = principal?.kind === 'email'
    ? await limitIdentity(store.limiterKey, `passkey-account:${origin}:${principal.email}`) : null;
  const load = async id => {
    const row = await store.db.prepare('SELECT * FROM customer_passkeys WHERE id = ?').bind(id).first();
    return row ? { ...row, value: await unseal(row.payload, key, `customer-passkey:${row.id}`) } : null;
  };
  async function challenge(kind, payload, options) {
    const id = token(), browser = token();
    await store.db.prepare('INSERT INTO customer_passkey_challenges (id, payload, expires_at) VALUES (?, ?, ?)')
      .bind(id, await seal({ ...payload, kind, origin, challenge: options.challenge, browser: await hash(browser) },
        key, `passkey-challenge:${id}`), now + 300000).run();
    return json(200, { challengeId: id, options }, { 'Set-Cookie': cookie(browser) });
  }
  async function consume(id, kind) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id ?? '')) reject(400, 'invalid_passkey');
    const row = await store.db.prepare('DELETE FROM customer_passkey_challenges WHERE id = ? AND expires_at > ? RETURNING payload').bind(id, now).first();
    if (!row) reject(403, 'invalid_passkey');
    const saved = await unseal(row.payload, key, `passkey-challenge:${id}`);
    const browser = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim())
      .find(value => value.startsWith(challengeCookie + '='))?.slice(challengeCookie.length + 1);
    if (saved.origin !== origin || saved.kind !== kind || saved.browser !== await hash(browser ?? '')
      || (kind === 'register' && saved.account !== account)) reject(403, 'invalid_passkey');
    return saved;
  }
  if (path === '/api/customer/passkeys/login/options' && request.method === 'POST') {
    await input(request, []);
    if (!await store.allow('passkey-start', request.headers.get('cf-connecting-ip') ?? 'unknown', 20, 3600000)) reject(429, 'rate_limited');
    return challenge('login', {}, await generateAuthenticationOptions({ rpID, userVerification: 'required' }));
  }
  if (path === '/api/customer/passkeys/login/verify' && request.method === 'POST') {
    const value = await input(request, ['challengeId', 'credential']);
    const saved = await consume(value.challengeId, 'login');
    const credentialID = value.credential?.id;
    if (typeof credentialID !== 'string' || credentialID.length > 2048) reject(403, 'invalid_passkey');
    const row = await load(await hash(credentialID));
    if (!row || row.value.origin !== origin || value.credential.response?.userHandle !== row.account) reject(403, 'invalid_passkey');
    let verified;
    try {
      verified = await verifyAuthenticationResponse({ response: value.credential, expectedChallenge: saved.challenge,
        expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: row.value.credentialID, publicKey: from64(row.value.publicKey),
          counter: row.counter, transports: row.value.transports } });
    } catch { reject(403, 'invalid_passkey'); }
    if (!verified.verified) reject(403, 'invalid_passkey');
    const updated = await store.db.prepare('UPDATE customer_passkeys SET counter = ?, last_used_at = ?, version = version + 1 WHERE id = ? AND version = ? RETURNING id')
      .bind(verified.authenticationInfo.newCounter, now, row.id, row.version).first();
    if (!updated) reject(403, 'invalid_passkey');
    return json(200, { signedIn: true }, { 'Set-Cookie': await createSession({
      kind: 'email', email: row.value.email, authenticatedAt: now, passkeyId: row.id,
    }) });
  }
  if (principal?.kind !== 'email') reject(401, 'access_required');
  if (path === '/api/customer/passkeys' && request.method === 'GET') {
    const { results } = await store.db.prepare('SELECT * FROM customer_passkeys WHERE account = ? ORDER BY created_at, id').bind(account).all();
    const passkeys = await Promise.all(results.map(async row => {
      const value = await unseal(row.payload, key, `customer-passkey:${row.id}`);
      return { id: row.id, name: value.name, createdAt: row.created_at, lastUsedAt: row.last_used_at, current: row.id === principal.passkeyId };
    }));
    return json(200, { passkeys, recentSignIn: recentAuthentication(principal, now) });
  }
  if (!recentAuthentication(principal, now)) reject(403, 'recent_sign_in_required');
  if (path === '/api/customer/passkeys/register/options' && request.method === 'POST') {
    const value = await input(request, ['name']);
    const label = name(value.name);
    const { results } = await store.db.prepare('SELECT id FROM customer_passkeys WHERE account = ?').bind(account).all();
    if (results.length >= 20) reject(409, 'passkey_limit');
    const existing = await Promise.all(results.map(row => load(row.id)));
    const options = await generateRegistrationOptions({ rpID, rpName: '127Vaults Manage',
      userID: from64(account), userName: principal.email, attestationType: 'none',
      supportedAlgorithmIDs: [-7, -257], authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: existing.map(row => ({ id: row.value.credentialID, transports: row.value.transports })) });
    return challenge('register', { account, name: label }, options);
  }
  if (path === '/api/customer/passkeys/register/verify' && request.method === 'POST') {
    const value = await input(request, ['challengeId', 'credential']);
    const saved = await consume(value.challengeId, 'register');
    let result;
    try {
      result = await verifyRegistrationResponse({ response: value.credential, expectedChallenge: saved.challenge,
        expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] });
    } catch { reject(403, 'invalid_passkey'); }
    if (!result.verified) reject(403, 'invalid_passkey');
    const credential = result.registrationInfo.credential;
    const id = await hash(credential.id);
    const payload = await seal({ email: principal.email, origin, name: saved.name, credentialID: credential.id,
      publicKey: base64url(credential.publicKey), transports: credential.transports }, key, `customer-passkey:${id}`);
    const inserted = await store.db.prepare('INSERT INTO customer_passkeys (id, account, payload, counter, created_at) SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM customer_passkeys WHERE account = ?) < 20 ON CONFLICT(id) DO NOTHING RETURNING id')
      .bind(id, account, payload, credential.counter, now, account).first();
    if (!inserted) reject(409, 'passkey_already_registered');
    return json(200, { added: true });
  }
  if (path === '/api/customer/passkeys/rename' && request.method === 'POST') {
    const value = await input(request, ['id', 'name']);
    const label = name(value.name), row = await load(typeof value.id === 'string' ? value.id : '');
    if (!row || row.account !== account) reject(404, 'not_found');
    const updated = await store.db.prepare('UPDATE customer_passkeys SET payload = ?, version = version + 1 WHERE id = ? AND version = ? RETURNING id')
      .bind(await seal({ ...row.value, name: label }, key, `customer-passkey:${row.id}`), row.id, row.version).first();
    if (!updated) reject(409, 'state_changed');
    return json(200, { renamed: true });
  }
  if (path === '/api/customer/passkeys/remove' && request.method === 'POST') {
    const value = await input(request, ['id']);
    if (typeof value.id !== 'string') reject(400, 'invalid_request');
    await store.db.prepare('DELETE FROM customer_passkeys WHERE id = ? AND account = ?').bind(value.id, account).run();
    return json(200, { removed: true });
  }
  reject(404, 'not_found');
}

import { from64, base64url as base64, hash, limitIdentity } from './crypto.mjs';
const cookieName = '__Host-access-browser';
const lifetime = 30 * 60 * 1000;
const encode = value => base64(new TextEncoder().encode(JSON.stringify(value)));
async function key(env) { return crypto.subtle.importKey('raw', from64(env.INTAKE_LIMITER_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function sign(env, value) { const payload = encode(value); return payload + '.' + base64(new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(payload)))); }
async function read(env, token) {
  try {
    if (typeof token !== 'string' || token.length > 1600) return null;
    const [payload, signature, extra] = token.split('.');
    if (extra || !await crypto.subtle.verify('HMAC', await key(env), from64(signature), new TextEncoder().encode(payload))) return null;
    return JSON.parse(new TextDecoder().decode(from64(payload)));
  } catch { return null; }
}
async function browser(env, request, now) {
  const raw = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const value = await read(env, raw);
  return value?.type === 'browser' && /^[a-f0-9-]{36}$/.test(value.id) && value.expires > now && value.expires <= now + 86400000 ? value : null;
}
export async function intakeChallenge(env, request, now = Date.now()) {
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) throw Error('Intake protection unavailable');
  const session = await browser(env, request, now) ?? { type: 'browser', id: crypto.randomUUID(), expires: now + 86400000 };
  const nonce = crypto.randomUUID();
  const challenge = await sign(env, { type: 'challenge', browser: session.id, nonce, issued: now,
    ip: await limitIdentity(await key(env), 'challenge-ip:' + (request.headers.get('cf-connecting-ip') ?? 'unknown')) });
  return { body: { open: true, protected: true, siteKey: env.TURNSTILE_SITE_KEY, challenge, challengeId: nonce, waitMs: Number(env.INTAKE_WAIT_MS) },
    cookie: `${cookieName}=${await sign(env, session)}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Strict` };
}
export async function verifyIntake(env, request, input, db, { now = Date.now(), fetchImpl = fetch } = {}) {
  const session = await browser(env, request, now), challenge = await read(env, input.challenge);
  const wait = Number(env.INTAKE_WAIT_MS), cooldown = Number(env.INTAKE_COOKIE_COOLDOWN_MS);
  if (!Number.isSafeInteger(wait) || wait < 1000 || !Number.isSafeInteger(cooldown) || cooldown < 1000) return 'unavailable';
  if (!session || challenge?.type !== 'challenge' || challenge.browser !== session.id
    || !/^[a-f0-9-]{36}$/.test(challenge.nonce) || !Number.isSafeInteger(challenge.issued)
    || challenge.ip !== await limitIdentity(await key(env), 'challenge-ip:' + (request.headers.get('cf-connecting-ip') ?? 'unknown'))
    || now < challenge.issued || now - challenge.issued > lifetime) return 'verification_required';
  if (now - challenge.issued < wait) return 'please_wait';
  if (typeof input.turnstileToken !== 'string' || input.turnstileToken.length < 1 || input.turnstileToken.length > 2048) return 'verification_required';
  let result;
  try {
    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: input.turnstileToken, remoteip: request.headers.get('cf-connecting-ip') }) });
    if (!response.ok) return 'verification_unavailable';
    result = await response.json();
  } catch { return 'verification_unavailable'; }
  if (result.success !== true || result.hostname !== new URL(env.PUBLIC_INTAKE_ORIGIN).hostname
    || result.action !== 'access-request' || result.cdata !== challenge.nonce) return 'verification_required';
  // Atomic claims stop parallel requests and reused browser challenges. Never store provider tokens.
  const claim = await db.prepare('INSERT INTO intake_challenges (id, expires_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING RETURNING id')
    .bind(await hash(challenge.nonce), now + lifetime).first();
  if (!claim) return 'verification_required';
  const allowed = await db.prepare(`INSERT INTO intake_browsers (id, next_at) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET next_at = excluded.next_at WHERE intake_browsers.next_at <= ? RETURNING id`)
    .bind(await hash(session.id), now + cooldown, now).first();
  return allowed ? null : 'rate_limited';
}

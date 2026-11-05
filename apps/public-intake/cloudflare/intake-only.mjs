import { validateRequest } from '../src/validate-request.mjs';
import { TrialStore } from './store.mjs';
import { from64, hash, token, limitIdentity } from './crypto.mjs';
import { rawBody, BillingError } from './dodo.mjs';
import { intakeChallenge, verifyIntake } from './intake-protection.mjs';

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (status, value) => new Response(JSON.stringify(value), { status, headers });
export default { async fetch(request, env, ctx) {
  try {
    const url = new URL(request.url);
    if (url.origin !== env.PUBLIC_INTAKE_ORIGIN) return json(403, { error: 'forbidden' });
    if (url.pathname !== '/api/waitlist') return json(404, { error: 'not_found' });
    if (request.method === 'GET') {
      if (env.INTAKE_PROTECTION !== '1') return json(200, { open: true });
      if (request.headers.get('sec-fetch-site') === 'cross-site') return json(403, { error: 'forbidden' });
      const challenge = await intakeChallenge(env, request);
      return new Response(JSON.stringify(challenge.body), { headers: { ...headers, 'Set-Cookie': challenge.cookie } });
    }
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (request.headers.get('origin') !== url.origin || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json(403, { error: 'forbidden' });
    // Intake has only contact-encryption and rate-limit keys: no issuer, operator key, Dodo key, or trial decryption key.
    const contactKey = await crypto.subtle.importKey('raw', from64(env.INTAKE_CONTACT_KEY), 'AES-GCM', false, ['encrypt']);
    const limiterKey = await crypto.subtle.importKey('raw', from64(env.INTAKE_LIMITER_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const store = new TrialStore(env.DB, contactKey, null, () => Date.now(), limiterKey);
    if (!await store.allow('waitlist-ip', request.headers.get('cf-connecting-ip') ?? 'unknown', 60, 3600000)) return json(429, { error: 'rate_limited' });
    let input, protection; try {
      const raw = JSON.parse(await rawBody(request, env.INTAKE_PROTECTION === '1' ? 6144 : 2048));
      protection = { challenge: raw.challenge, turnstileToken: raw.turnstileToken };
      delete raw.challenge; delete raw.turnstileToken;
      input = validateRequest(raw);
    }
    catch (error) { if (error instanceof BillingError) throw error; return json(400, { error: 'invalid_request' }); }
    if (!input) return json(400, { error: 'invalid_request' });
    if (env.INTAKE_PROTECTION === '1' && !input.contactName) return json(400, { error: 'name_required' });
    if (env.INTAKE_PROTECTION === '1' && !input.trapped) {
      const error = await verifyIntake(env, request, protection, store.db);
      if (error) return json(error === 'rate_limited' ? 429 : error.includes('unavailable') ? 503 : 403, { error });
    }
    if (!await store.allow('waitlist-email', input.email, 3, 3600000)) return json(429, { error: 'rate_limited' });
    if (!input.trapped) {
      const { trapped: _, ...contact } = input;
      const id = await hash(token());
      await store.insert(id, { ...contact, receivedAt: new Date().toISOString() });
      if (env.INTAKE_PROTECTION === '1') await store.db.prepare('INSERT INTO intake_activity (request_id, email_hash, received_at) VALUES (?, ?, ?)')
        .bind(id, await limitIdentity(limiterKey, 'intake-volume:' + contact.email), Date.now()).run();
      if (env.ALERTS) {
        const notify = env.ALERTS.notify(id).catch(() => {});
        if (ctx?.waitUntil) ctx.waitUntil(notify); else await notify;
      }
    }
    return json(202, { received: true });
  } catch (error) { return json(error instanceof BillingError ? error.status : 503, { error: error instanceof BillingError ? error.message : 'unavailable' }); }
} };

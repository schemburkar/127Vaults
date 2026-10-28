import { validateRequest } from '../src/validate-request.mjs';
import { TrialStore } from './store.mjs';
import { from64, hash, token } from './crypto.mjs';
import { rawBody, BillingError } from './dodo.mjs';

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (status, value) => new Response(JSON.stringify(value), { status, headers });
export default { async fetch(request, env) {
  try {
    const url = new URL(request.url);
    if (url.origin !== env.PUBLIC_INTAKE_ORIGIN) return json(403, { error: 'forbidden' });
    if (url.pathname !== '/api/waitlist') return json(404, { error: 'not_found' });
    if (request.method === 'GET') return json(200, { open: true });
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (request.headers.get('origin') !== url.origin || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json(403, { error: 'forbidden' });
    // Intake has only contact-encryption and rate-limit keys: no issuer, operator key, Dodo key, or trial decryption key.
    const contactKey = await crypto.subtle.importKey('raw', from64(env.INTAKE_CONTACT_KEY), 'AES-GCM', false, ['encrypt']);
    const limiterKey = await crypto.subtle.importKey('raw', from64(env.INTAKE_LIMITER_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const store = new TrialStore(env.DB, contactKey, null, () => Date.now(), limiterKey);
    if (!await store.allow('waitlist-ip', request.headers.get('cf-connecting-ip') ?? 'unknown', 60, 3600000)) return json(429, { error: 'rate_limited' });
    let input; try { input = validateRequest(JSON.parse(await rawBody(request, 2048))); }
    catch (error) { if (error instanceof BillingError) throw error; return json(400, { error: 'invalid_request' }); }
    if (!input) return json(400, { error: 'invalid_request' });
    if (!await store.allow('waitlist-email', input.email, 3, 3600000)) return json(429, { error: 'rate_limited' });
    if (!input.trapped) {
      const { trapped: _, ...contact } = input;
      await store.insert(await hash(token()), { ...contact, receivedAt: new Date().toISOString() });
    }
    return json(202, { received: true });
  } catch (error) { return json(error instanceof BillingError ? error.status : 503, { error: error instanceof BillingError ? error.message : 'unavailable' }); }
} };

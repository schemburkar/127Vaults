import { bytes, from64, equal } from './crypto.mjs';

export class BillingError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}
export const reject = (status, code) => { throw new BillingError(status, code); };
export class DodoError extends Error { constructor(status) { super('Billing provider unavailable'); this.providerStatus = status; } }
export const paidPersonalAccess = (record, now) => record?.kind === 'personal-purchase'
  && !record.billing?.suspended && record.billing?.lastPayment?.status === 'succeeded'
  && record.billing.lastPayment.amount > 0 && Date.parse(record.billing.paidThrough) > now;
export const personalBuyerAllowed = (env, email) => env.DODO_MODE === 'live_mode'
  || env.LOCAL_SITE_PREVIEW === '1' || Boolean(email && env.DODO_TEST_BUYER === email);
export function billingConfig(env) {
  if (env.DODO_ENABLED !== '1') reject(404, 'not_found');
  const mode = env.DODO_MODE ?? 'test_mode';
  if (!['test_mode', 'live_mode'].includes(mode) || !env.DODO_API_KEY || !env.DODO_WEBHOOK_SECRET || !env.DODO_BUSINESS_ID) throw Error('Billing configuration incomplete');
  const plans = JSON.parse(env.DODO_PLANS ?? '{}');
  if (!plans || Array.isArray(plans) || typeof plans !== 'object' || Object.keys(plans).length === 0) throw Error('Billing plans missing');
  const products = new Set();
  for (const [slug, plan] of Object.entries(plans)) {
    if (!/^[a-z0-9-]{1,60}$/.test(slug) || !/^pdt_[A-Za-z0-9]+$/.test(plan.productId)
      || !['personal', 'commercial'].includes(plan.plan)
      || (plan.plan === 'personal' && (!Number.isSafeInteger(plan.majorVersion) || plan.majorVersion < (mode === 'test_mode' ? 0 : 1)))
      || !Number.isSafeInteger(plan.maxUsers) || plan.maxUsers < 1 || plan.maxUsers > 100000) throw Error('Invalid billing plan');
    if (products.has(plan.productId)) throw Error('Duplicate billing product');
    products.add(plan.productId);
  }
  return { mode, plans, base: mode === 'test_mode' ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com' };
}
export async function dodo(env, path, method = 'GET', value, fetcher = fetch) {
  const { base } = billingConfig(env);
  const response = await fetcher(base + path, { method, redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${env.DODO_API_KEY}`, 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  if (!response.ok) throw new DodoError(response.status);
  return response.status === 204 ? null : response.json();
}
export async function rawBody(request, maximum = 262144) {
  if (Number(request.headers.get('content-length')) > maximum) reject(413, 'too_large');
  const reader = request.body?.getReader(); if (!reader) reject(400, 'invalid_request');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > maximum) { await reader.cancel(); reject(413, 'too_large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(all);
}
// Dodo follows Standard Webhooks: sign the exact id.timestamp.raw-body bytes.
export async function verifyWebhook(request, env, now) {
  billingConfig(env);
  const id = request.headers.get('webhook-id'), timestamp = request.headers.get('webhook-timestamp');
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id ?? '') || !/^\d{10}$/.test(timestamp ?? '')
    || Math.abs(now - Number(timestamp) * 1000) > 300000) reject(401, 'invalid_signature');
  const raw = await rawBody(request);
  const secrets = [env.DODO_WEBHOOK_SECRET, env.DODO_WEBHOOK_SECRET_PREVIOUS].filter(Boolean);
  let valid = false;
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey('raw', from64(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes(`${id}.${timestamp}.${raw}`)));
    const expected = btoa(String.fromCharCode(...signed));
    for (const entry of (request.headers.get('webhook-signature') ?? '').split(' ')) {
      if (entry.startsWith('v1,') && await equal(expected, entry.slice(3))) valid = true;
    }
  }
  if (!valid) reject(401, 'invalid_signature');
  let event; try { event = JSON.parse(raw); } catch { reject(400, 'invalid_request'); }
  if (event.business_id !== env.DODO_BUSINESS_ID || !event.data || typeof event.type !== 'string'
    || !Number.isFinite(Date.parse(event.timestamp))) reject(400, 'invalid_event');
  return { id, event };
}

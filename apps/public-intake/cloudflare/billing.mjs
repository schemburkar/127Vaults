import { billingConfig, dodo, reject, verifyWebhook, rawBody, DodoError } from './dodo.mjs';
import { equal, hash, token, signEnvelope, from64, seal, unseal } from './crypto.mjs';
import { customerCanAccess } from './customer-portal.mjs';

const day = 86400000;
const iso = at => new Date(at).toISOString();
const payload = source => JSON.parse(new TextDecoder().decode(from64(JSON.parse(source).payload)));
const publicStatus = b => ({ status: b.status, plan: b.planSlug, paidThrough: b.paidThrough ?? null,
  graceUntil: b.paidThrough ? iso(Date.parse(b.paidThrough) + 30 * day) : null,
  cancelAtPeriodEnd: Boolean(b.cancelAtPeriodEnd), lastCheckedAt: b.lastCheckedAt ?? null });
async function input(request) {
  let value; try { value = JSON.parse(await rawBody(request, 4096)); } catch { reject(400, 'invalid_request'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') reject(400, 'invalid_request');
  return value;
}
const fields = (value, names) => { if (Object.keys(value).some(key => !names.includes(key))) reject(400, 'invalid_request'); };
function safeLink(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/(^|\.)dodopayments\.com$/.test(url.hostname) || url.username || url.password) throw Error('Invalid billing URL');
  return url.href;
}
export async function syncSubscription(env, store, row, release, now, fetcher = fetch, subscriptionId) {
  const b = row.trial?.billing;
  if (!b) reject(409, 'billing_unavailable');
  if (b.suspended) return row;
  const { mode, plans } = billingConfig(env);
  if (b.mode !== mode) throw Error('Billing environment mismatch');
  if (!subscriptionId && !b.subscriptionId && b.sessionId) {
    const checkout = await dodo(env, `/checkouts/${encodeURIComponent(b.sessionId)}`, 'GET', undefined, fetcher);
    subscriptionId = checkout.subscription_id;
    if (!subscriptionId && checkout.payment_id) {
      const payment = await dodo(env, `/payments/${encodeURIComponent(checkout.payment_id)}`, 'GET', undefined, fetcher);
      subscriptionId = payment.subscription_id;
    }
  }
  subscriptionId ??= b.subscriptionId;
  if (!subscriptionId) return row;
  const sub = await dodo(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`, 'GET', undefined, fetcher);
  if (row.trial.billingHistory?.some(v => v.subscriptionId === subscriptionId && sub.metadata?.order_id === v.orderId)) return row;
  const plan = plans[b.planSlug];
  if (!plan || sub.subscription_id !== subscriptionId || (b.subscriptionId && b.subscriptionId !== subscriptionId)
    || sub.metadata?.access_request_id !== row.id || sub.metadata?.order_id !== b.orderId
    || sub.metadata?.billing_mode !== mode || sub.product_id !== b.productId || sub.product_id !== plan.productId
    || sub.quantity !== 1 || sub.trial_period_days !== 0 || !sub.customer?.customer_id
    || (b.customerId && b.customerId !== sub.customer.customer_id)) throw Error('Subscription binding mismatch');
  const next = { ...row.trial, billing: { ...b, subscriptionId, customerId: sub.customer.customer_id,
    status: sub.status, cancelAtPeriodEnd: sub.cancel_at_next_billing_date, lastCheckedAt: iso(now) } };
  if (['past_due', 'on_hold', 'paused'].includes(sub.status) && b.paidThrough
    && now >= Date.parse(b.paidThrough) + 30 * day) {
    await dodo(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`, 'PATCH', { status: 'cancelled' }, fetcher);
    next.billing.status = 'cancelled';
  }
  if (sub.status === 'active') {
    const end = Date.parse(sub.next_billing_date);
    if (!Number.isFinite(end) || end <= now || end > now + 370 * day) throw Error('Invalid subscription period');
    next.billing.paidThrough = iso(end);
    // The signed expiry is the paid period boundary. Failure never advances it.
    if (next.installationId && (!next.license || next.billing.issuedOrderId !== b.orderId || payload(next.license).expiresAt !== iso(end)
      || payload(next.license).plan !== plan.plan || payload(next.license).maxActiveUsers !== plan.maxUsers)) {
      const { signingKey } = await release(env);
      next.license = await signEnvelope(signingKey, env.TRIAL_ISSUER_KEY_ID, '127Vaults license v1', {
        licenseId: crypto.randomUUID(), installationId: next.installationId,
        plan: plan.plan, majorVersion: null, maxActiveUsers: plan.maxUsers, issuedAt: iso(now), notBefore: iso(now),
        expiresAt: iso(end), sequence: (next.license ? payload(next.license).sequence : 0) + 1,
      });
      next.expiresAt = iso(end); next.maxUsers = plan.maxUsers;
      next.billing.issuedOrderId = b.orderId;
    }
  }
  await store.save(row, next);
  return row;
}
export async function billingWebhook(request, env, store, release, now, fetcher = fetch, schedule) {
  const { id, event } = await verifyWebhook(request, env, now);
  if (schedule) {
    await persistBillingEvent(id, event, store, now);
    schedule(processBillingEvent(id, event, env, store, release, now, fetcher).catch(() => {}));
    return { received: true };
  }
  return processBillingEvent(id, event, env, store, release, now, fetcher);
}
async function persistBillingEvent(id, event, store, now) {
  const requestId = event.data.metadata?.access_request_id;
  if (requestId && !/^[a-f0-9]{64}$/.test(requestId)) reject(400, 'invalid_event');
  await store.db.prepare('INSERT OR IGNORE INTO billing_events (id, request_id, received_at, event) VALUES (?, ?, ?, ?)')
    .bind(id, requestId ?? null, now, await seal(event, store.trialKey, `billing-event:${id}`)).run();
}
async function processBillingEvent(id, event, env, store, release, now, fetcher) {
  const prior = await store.db.prepare('SELECT processed_at FROM billing_events WHERE id = ?').bind(id).first();
  if (prior?.processed_at) return { received: true };
  let requestId = event.data.metadata?.access_request_id;
  // Persist verified input before the first provider call so scheduled replay survives exhausted provider retries.
  await persistBillingEvent(id, event, store, now);
  let subId = event.data.subscription_id;
  let payment;
  if (event.data.payment_id && !event.type.startsWith('subscription.')) {
    payment = await dodo(env, `/payments/${encodeURIComponent(event.data.payment_id)}`, 'GET', undefined, fetcher);
    subId ??= payment.subscription_id;
  }
  if (!requestId && subId) {
    const sub = await dodo(env, `/subscriptions/${encodeURIComponent(subId)}`, 'GET', undefined, fetcher);
    requestId = sub.metadata?.access_request_id;
  }
  if (requestId && !/^[a-f0-9]{64}$/.test(requestId)) reject(400, 'invalid_event');
  if (requestId) await store.db.prepare('UPDATE billing_events SET request_id = ? WHERE id = ?').bind(requestId, id).run();
  if (requestId && subId) {
    const row = await store.get(requestId);
    if (!row?.trial?.billing) throw Error('Unknown subscription order');
    // Always retrieve current provider state: delayed events cannot resurrect old access.
    await syncSubscription(env, store, row, release, now, fetcher, subId);
    if (payment && payment.subscription_id === row.trial.billing.subscriptionId) {
      const b = row.trial.billing;
      const current = !b.lastPayment || Date.parse(payment.created_at) >= Date.parse(b.lastPayment.createdAt);
      if (current && payment.status === 'succeeded') {
        const next = { ...row.trial, billing: { ...b, lastPayment: { id: payment.payment_id, createdAt: payment.created_at,
          amount: payment.total_amount, currency: payment.currency, status: payment.status } } };
        const fullyRefunded = payment.refunds?.some(v => v.status === 'succeeded' && v.is_partial === false);
        const coversCurrentPeriod = payment.service_periods?.some(v => v.subscription_id === subId
          && Date.parse(v.ends_at) >= Date.parse(b.paidThrough));
        if ((fullyRefunded || event.type === 'dispute.lost') && coversCurrentPeriod && next.license) {
          const { signingKey } = await release(env), license = payload(next.license);
          next.billing.suspended = true; next.billing.status = fullyRefunded ? 'refunded' : 'disputed';
          next.billing.revocation = await signEnvelope(signingKey, env.TRIAL_ISSUER_KEY_ID, '127Vaults license revocation v1', {
            revocationId: crypto.randomUUID(), installationId: next.installationId, licenseId: license.licenseId,
            issuedAt: iso(now), revokedAt: iso(now),
          });
          await dodo(env, `/subscriptions/${encodeURIComponent(subId)}`, 'PATCH', { status: 'cancelled' }, fetcher);
        }
        await store.save(row, next);
      }
    }
  }
  await store.db.prepare('UPDATE billing_events SET processed_at = ? WHERE id = ?').bind(now, id).run();
  return { received: true };
}
export async function handleBilling(request, env, store, release, now, operatorAuthorized, fetcher = fetch) {
  const path = new URL(request.url).pathname;
  const customerOrigin = env.CUSTOMER_ORIGIN ?? env.PUBLIC_INTAKE_ORIGIN;
  if (!path.startsWith('/api/billing/') && !path.startsWith('/api/access-admin/billing/')) return null;
  const config = billingConfig(env);
  const admin = path.startsWith('/api/access-admin/');
  if (admin && !operatorAuthorized) reject(401, 'access_required');
  if (!await store.allow(admin ? 'billing-admin' : 'billing-ip', request.headers.get('cf-connecting-ip') ?? 'unknown', 120, 3600000)) reject(429, 'rate_limited');
  if (path === '/api/access-admin/billing/plans' && request.method === 'GET') {
    return { mode: config.mode, plans: Object.entries(config.plans).map(([id, value]) => ({ id, maxUsers: value.maxUsers })) };
  }
  if (path === '/api/access-admin/billing/health' && request.method === 'GET') {
    return { reconciliation: await store.db.prepare('SELECT checked_at, checked, failed FROM billing_health WHERE singleton = 1').first(),
      pendingEvents: (await store.db.prepare('SELECT COUNT(*) AS count FROM billing_events WHERE processed_at IS NULL').first()).count };
  }
  if (path === '/api/access-admin/billing/coupons' && request.method === 'POST') {
    const v = await input(request); fields(v, ['plan', 'basisPoints', 'cycles', 'usageLimit', 'expiresAt']);
    const plan = config.plans[v.plan];
    if (!plan || !Number.isInteger(v.basisPoints) || v.basisPoints < 1 || v.basisPoints > 10000
      || !Number.isInteger(v.cycles) || v.cycles < 1 || v.cycles > 1200
      || !Number.isInteger(v.usageLimit) || v.usageLimit < 1 || v.usageLimit > 10000
      || !(Date.parse(v.expiresAt) > now && Date.parse(v.expiresAt) <= now + 366 * day)) reject(400, 'invalid_coupon');
    const code = token().replace(/[-_]/g, '').slice(0, 16).toUpperCase();
    return dodo(env, '/discounts', 'POST', { code, type: 'percentage', amount: v.basisPoints,
      subscription_cycles: v.cycles, usage_limit: v.usageLimit, per_customer_usage_limit: 1,
      expires_at: iso(Date.parse(v.expiresAt)), restricted_to: [plan.productId],
      metadata: { source: '127vaults-operator' } }, fetcher).then(v => ({ code: v.code, discountId: v.discount_id }));
  }
  const revokeCoupon = /^\/api\/access-admin\/billing\/coupons\/([A-Za-z0-9_-]+)\/revoke$/.exec(path);
  if (revokeCoupon && request.method === 'POST') {
    fields(await input(request), []);
    await dodo(env, `/discounts/${revokeCoupon[1]}`, 'DELETE', undefined, fetcher); return { revoked: true };
  }
  const match = /^\/api\/(?:access-admin\/)?billing\/([a-f0-9]{64})(?:\/(offer|checkout|portal|cancel|refresh|license|payments|recover-checkout|rotate-refresh))?$/.exec(path);
  if (!match) reject(404, 'not_found');
  const [, id, action] = match;
  const row = await store.get(id), record = row?.trial;
  if (!record || record.state !== 'approved' || (['offer', 'checkout', 'license'].includes(action) && (record.replacementRequest || record.revocation))) reject(404, 'not_found');
  const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  // Machine refresh credentials cannot open checkout or customer billing sessions.
  const machine = action === 'refresh' && record.billing?.refreshHash && await equal(await hash(bearer ?? ''), record.billing.refreshHash);
  const portalAuthorized = !admin && !machine && await customerCanAccess(request, env, store, row, now, 'billing');
  if (!admin && !machine && !portalAuthorized && (!bearer || !await equal(await hash(bearer), record.tokenHash)
    || Date.parse(record.linkExpiresAt) <= now)) reject(401, 'access_required');
  if (admin && action === 'offer' && request.method === 'POST') {
    const v = await input(request); fields(v, ['plan']); const plan = config.plans[v.plan];
    if (!plan || record.kind === 'development') reject(409, 'offer_unavailable');
    if (record.billing) {
      if (record.billing.suspended) {
        const prior = await dodo(env, `/subscriptions/${encodeURIComponent(record.billing.subscriptionId)}`, 'GET', undefined, fetcher);
        if (prior.status !== 'cancelled' || prior.subscription_id !== record.billing.subscriptionId) reject(409, 'offer_unavailable');
      } else {
        await syncSubscription(env, store, row, release, now, fetcher);
        if (!['cancelled', 'failed', 'expired'].includes(row.trial.billing.status)) reject(409, 'offer_unavailable');
      }
    }
    const refreshToken = token();
    await store.save(row, { ...row.trial, billingHistory: [...(row.trial.billingHistory ?? []), ...(row.trial.billing ? [row.trial.billing] : [])], billing: { mode: config.mode, planSlug: v.plan, productId: plan.productId,
      status: 'offered', orderId: crypto.randomUUID(), refreshHash: await hash(refreshToken) } });
    return { ...publicStatus(row.trial.billing), refreshToken, refreshUrl: `${customerOrigin}/api/billing/${id}/refresh` };
  }
  if (!record.billing) reject(404, 'not_found');
  if (admin && action === 'rotate-refresh' && request.method === 'POST') {
    fields(await input(request), []); const refreshToken = token();
    await store.save(row, { ...record, billing: { ...record.billing, refreshHash: await hash(refreshToken) } });
    return { refreshToken, refreshUrl: `${customerOrigin}/api/billing/${id}/refresh` };
  }
  if (admin && action === 'recover-checkout' && request.method === 'POST') {
    const value = await input(request); fields(value, ['sessionId']);
    if (record.billing.status !== 'checkout_pending' || record.billing.sessionId || !/^cks_[A-Za-z0-9]+$/.test(value.sessionId ?? '')) reject(409, 'recovery_unavailable');
    const checkout = await dodo(env, `/checkouts/${encodeURIComponent(value.sessionId)}`, 'GET', undefined, fetcher);
    if (!checkout.payment_id) reject(409, 'checkout_not_paid');
    const payment = await dodo(env, `/payments/${encodeURIComponent(checkout.payment_id)}`, 'GET', undefined, fetcher);
    if (!payment.subscription_id) reject(409, 'checkout_not_paid');
    await syncSubscription(env, store, row, release, now, fetcher, payment.subscription_id);
    await store.save(row, { ...row.trial, billing: { ...row.trial.billing, sessionId: value.sessionId } });
    return publicStatus(row.trial.billing);
  }
  if (action === 'payments' && request.method === 'GET') {
    const { results } = await store.db.prepare('SELECT id, event FROM billing_events WHERE request_id = ? ORDER BY received_at DESC LIMIT 100').bind(id).all();
    const events = await Promise.all(results.map(async v => {
      const event = await unseal(v.event, store.trialKey, `billing-event:${v.id}`);
      return { type: event.type, at: event.timestamp, paymentId: event.data.payment_id ?? null,
        amount: event.data.total_amount ?? event.data.amount ?? null, currency: event.data.currency ?? null };
    }));
    return { events };
  }
  if (!action && request.method === 'GET') return publicStatus(record.billing);
  if (action === 'checkout' && request.method === 'POST' && !admin) {
    const v = await input(request); fields(v, ['coupon']);
    if (v.coupon !== undefined && !/^[A-Za-z0-9_-]{3,16}$/.test(v.coupon)) reject(400, 'invalid_coupon');
    if (!['offered'].includes(record.billing.status) || !record.installationId) reject(409, 'checkout_unavailable');
    // Reserve durably before calling the provider. An ambiguous timeout must be reconciled by an operator, never retried into a duplicate subscription.
    await store.save(row, { ...record, billing: { ...record.billing, status: 'checkout_pending', checkoutStartedAt: iso(now) } });
    let result;
    try { result = await dodo(env, '/checkouts', 'POST', {
      product_cart: [{ product_id: record.billing.productId, quantity: 1 }],
      customer: { email: row.contact.email }, subscription_data: { trial_period_days: 0 },
      metadata: { access_request_id: id, order_id: record.billing.orderId, billing_mode: config.mode },
      ...(v.coupon ? { discount_codes: [v.coupon.toUpperCase()] } : {}),
      feature_flags: { allow_discount_code: true }, return_url: `${customerOrigin}/portal?billing=return`,
    }, fetcher); }
    catch (error) {
      if (error instanceof DodoError && [400, 422].includes(error.providerStatus)) {
        await store.save(row, { ...row.trial, billing: { ...row.trial.billing, status: 'offered' } });
        reject(400, 'checkout_rejected');
      }
      throw error;
    }
    const checkoutUrl = safeLink(result.checkout_url);
    if (!result.session_id) throw Error('Missing checkout identity');
    await store.save(row, { ...row.trial, billing: { ...row.trial.billing, sessionId: result.session_id } });
    return { checkoutUrl };
  }
  if (action === 'portal' && request.method === 'POST' && !admin) {
    fields(await input(request), []);
    if (!record.billing.customerId) reject(409, 'billing_unavailable');
    const result = await dodo(env, `/customers/${encodeURIComponent(record.billing.customerId)}/customer-portal/session`, 'POST', {}, fetcher);
    return { portalUrl: safeLink(result.link) };
  }
  if (action === 'cancel' && request.method === 'POST' && !admin) {
    fields(await input(request), []);
    if (!record.billing.subscriptionId) reject(409, 'billing_unavailable');
    await dodo(env, `/subscriptions/${encodeURIComponent(record.billing.subscriptionId)}`, 'PATCH', { cancel_at_next_billing_date: true }, fetcher);
    await syncSubscription(env, store, row, release, now, fetcher); return publicStatus(row.trial.billing);
  }
  if (action === 'refresh' && request.method === 'POST') {
    const value = await input(request); fields(value, ['installationId']);
    if (value.installationId && value.installationId !== record.installationId) {
      const retired = record.replacementHistory?.find(v => v.installationId === value.installationId && v.license && v.revocation);
      if (!retired) reject(409, 'installation_mismatch');
      return { status: 'replaced', license: retired.license, revocation: retired.revocation };
    }
    if (record.revocation) return { status: 'replacement_pending', license: record.license, revocation: record.revocation };
    await syncSubscription(env, store, row, release, now, fetcher);
    return { ...publicStatus(row.trial.billing), license: row.trial.license ?? null, revocation: row.trial.billing.revocation ?? null };
  }
  if (action === 'license' && request.method === 'GET') {
    return { license: record.license ?? null, ...publicStatus(record.billing) };
  }
  reject(405, 'method_not_allowed');
}
export async function reconcileBilling(env, store, release, now, fetcher = fetch) {
  if (env.DODO_ENABLED !== '1') return { checked: 0, failed: 0 };
  let checked = 0, failed = 0;
  const { results: pending } = await store.db.prepare('SELECT id, event FROM billing_events WHERE processed_at IS NULL ORDER BY received_at LIMIT 50').all();
  for (const entry of pending) {
    try {
      const event = await unseal(entry.event, store.trialKey, `billing-event:${entry.id}`);
      await processBillingEvent(entry.id, event, env, store, release, now, fetcher);
    } catch { failed++; }
  }
  for (const row of await store.list()) {
    if (!row.trial?.billing || row.trial.state !== 'approved') continue;
    try { await syncSubscription(env, store, row, release, now, fetcher); checked++; }
    catch { failed++; }
  }
  await store.db.prepare('INSERT INTO billing_health (singleton, checked_at, checked, failed) VALUES (1, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET checked_at = excluded.checked_at, checked = excluded.checked, failed = excluded.failed')
    .bind(now, checked, failed).run();
  return { checked, failed };
}

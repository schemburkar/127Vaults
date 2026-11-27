import { retrieveSettlement } from './settlement-provider.mjs';
import { compatiblePersonalMajor } from '../../server/src/license-version.mjs';
import { issueClientLink } from './client-downloads.mjs';
import { billingConfig, dodo, reject, verifyWebhook, rawBody, DodoError, paidPersonalAccess, personalBuyerAllowed, convertibleInstallation } from './dodo.mjs';
import { equal, hash, token, signEnvelope, from64, seal, unseal, limitIdentity } from './crypto.mjs';
import { customerCanAccess, customerPrincipal } from './customer-portal.mjs';
import { serverMajor } from './catalogue.mjs';
import { confirmPersonalTrial, personalTrialId, startPersonalTrial } from './personal-trial.mjs';

const day = 86400000;
const iso = at => new Date(at).toISOString();
const payload = source => JSON.parse(new TextDecoder().decode(from64(JSON.parse(source).payload)));
export async function issuePersonalLicense(record, signingKey, issuerKeyId, now) {
  return signEnvelope(signingKey, issuerKeyId, '127Vaults license v1', {
    licenseId: crypto.randomUUID(), installationId: record.installationId,
    plan: 'personal', majorVersion: record.serverMajorVersion, maxActiveUsers: record.maxUsers,
    issuedAt: iso(now), notBefore: iso(now), expiresAt: record.billing.paidThrough,
    sequence: (record.license ? payload(record.license).sequence : record.conversionSequence ?? 0) + 1,
  });
}
export async function claimPersonalConversion(store, row, installationId) {
  const record = row.trial;
  const source = await store.get(record.conversionSourceId);
  const prior = source?.trial;
  if (record.billing.mode !== 'live_mode' || record.conversionInstallationId !== installationId
    || prior?.installationId !== installationId || !source.contact || source.contact.email.toLowerCase() !== row.contact.email.toLowerCase()
    || (prior.convertedPurchaseId !== row.id && !convertibleInstallation(prior, {
      majorVersion: record.serverMajorVersion, maxUsers: record.maxUsers,
    }))) reject(409, 'conversion_unavailable');
  if (!prior.convertedPurchaseId) await store.save(source, { ...prior, convertedPurchaseId: row.id });
  return payload(prior.license).sequence;
}
const canResubscribe = record => record.kind === 'personal-purchase' && !record.billing.suspended
  && Boolean(record.billing.subscriptionId) && ['cancelled', 'expired', 'failed'].includes(record.billing.status);
const publicStatus = b => ({ status: b.status, plan: b.planSlug, paidThrough: b.paidThrough ?? null,
  graceUntil: b.paidThrough ? iso(Date.parse(b.paidThrough) + 30 * day) : null,
  cancelAtPeriodEnd: Boolean(b.cancelAtPeriodEnd), lastCheckedAt: b.lastCheckedAt ?? null,
  settlement: b.settlement ? { state:b.settlement.state, amount:b.settlement.amount, currency:b.settlement.currency, normalAmount:b.settlement.normalAmount??null, discountAmount:b.settlement.discountAmount??null, discounts:b.settlement.discounts?.map(d=>({subscriptionCycles:d.subscriptionCycles,cyclesRemaining:d.cyclesRemaining}))??[] } : null,
  settlementReason:b.settlementCheck?.reason??null });
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
async function suspendSubscription(env, store, row, next, release, now, fetcher, status) {
  if (row.trial.billing.suspended && !row.trial.billing.cancelPending) return;
  next.billing.suspended = true;
  next.billing.status = status;
  next.billing.cancelPending = true;
  await store.save(row, next);
  if (next.license && !next.billing.revocation) {
    const { signingKey } = await release(env), license = payload(next.license);
    next.billing.revocation = await signEnvelope(signingKey, env.TRIAL_ISSUER_KEY_ID, '127Vaults license revocation v1', {
      revocationId: crypto.randomUUID(), installationId: next.installationId, licenseId: license.licenseId,
      issuedAt: iso(now), revokedAt: iso(now),
    });
  }
  // Save the denial/revocation before cancellation. A provider timeout cannot lose
  // the security decision or force another license/revocation sequence.
  await store.save(row, next);
  try {
    await dodo(env, `/subscriptions/${encodeURIComponent(next.billing.subscriptionId)}`, 'PATCH', { status: 'cancelled' }, fetcher);
  } catch(error) {
    if(error instanceof DodoError || ['TimeoutError','AbortError','TypeError'].includes(error.name)) return;
    throw error;
  }
  await store.save(row, { ...row.trial, billing: { ...row.trial.billing, cancelPending: false } });
}
export async function syncSubscription(env, store, row, release, now, fetcher = fetch, subscriptionId, eventPayment) {
  const b = row.trial?.billing;
  if (!b) reject(409, 'billing_unavailable');
  const { mode, plans } = billingConfig(env);
  if (b.mode !== mode) throw Error('Billing environment mismatch');
  if (b.suspended) {
    if (b.cancelPending) await suspendSubscription(env, store, row,
      { ...row.trial, billing: { ...b } }, release, now, fetcher, b.status);
    return row;
  }
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
    const personal = next.kind === 'personal-purchase';
    if(personal) {
      const settlement=await retrieveSettlement(env,row,sub,plan,now,fetcher,eventPayment);
      next.billing.settlementCheck={state:settlement.state,reason:settlement.reason,at:iso(now)};
      if(settlement.entitled) {
        next.billing.settlement=settlement;
        next.billing.paidThrough=settlement.periodEnd;
        next.billing.currency=settlement.currency;
        next.billing.lastPayment={id:settlement.paymentId,createdAt:settlement.createdAt,amount:settlement.amount,currency:settlement.currency,status:'succeeded'};
      } else if(settlement.state==='suspended') {
        await suspendSubscription(env, store, row, next, release, now, fetcher, settlement.reason==='payment_refunded'?'refunded':'disputed');
        return row;
      }
    } else next.billing.paidThrough=iso(end);
    // Only a confirmed service period can advance a signed license.
    if (next.installationId && (!personal || (paidPersonalAccess(next, now) && next.billing.paidThrough === iso(end))) &&
      (!next.license || next.billing.issuedOrderId !== b.orderId || payload(next.license).expiresAt !== iso(end)
      || payload(next.license).plan !== plan.plan || payload(next.license).maxActiveUsers !== (personal ? next.maxUsers : plan.maxUsers))) {
      const { signingKey } = await release(env);
      next.maxUsers = personal ? next.maxUsers : plan.maxUsers;
      next.license = personal ? await issuePersonalLicense(next, signingKey, env.TRIAL_ISSUER_KEY_ID, now)
        : await signEnvelope(signingKey, env.TRIAL_ISSUER_KEY_ID, '127Vaults license v1', {
        licenseId: crypto.randomUUID(), installationId: next.installationId,
        plan: plan.plan, majorVersion: null, maxActiveUsers: plan.maxUsers, issuedAt: iso(now), notBefore: iso(now),
        expiresAt: iso(end), sequence: (next.license ? payload(next.license).sequence : 0) + 1,
      });
      next.expiresAt = iso(end);
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
    requestId ??= payment.metadata?.access_request_id;
    subId ??= payment.subscription_id;
  }
  if (!requestId && subId) {
    const sub = await dodo(env, `/subscriptions/${encodeURIComponent(subId)}`, 'GET', undefined, fetcher);
    requestId = sub.metadata?.access_request_id;
  }
  if (requestId && !/^[a-f0-9]{64}$/.test(requestId)) reject(400, 'invalid_event');
  if (requestId) await store.db.prepare('UPDATE billing_events SET request_id = ? WHERE id = ?').bind(requestId, id).run();
  if (requestId && !subId && event.type === 'payment.succeeded' && payment) {
    const row = await store.get(requestId);
    if (row?.trial?.kind === 'personal-trial') {
      // An early webhook can race the local checkout write. Keep it eligible for scheduled replay.
      if (row.trial.state === 'trial_pending' && !row.trial.trialCheckout.sessionId) throw Error('Trial checkout pending');
      await confirmPersonalTrial(env, store, row, now, fetcher, payment);
    }
  }
  if (requestId && subId) {
    const row = await store.get(requestId);
    if (!row?.trial?.billing) throw Error('Unknown subscription order');
    // Always retrieve current provider state: delayed events cannot resurrect old access.
    await syncSubscription(env, store, row, release, now, fetcher, subId, payment);
    if (payment && payment.subscription_id === row.trial.billing.subscriptionId
      && payment.metadata?.access_request_id === row.id && payment.metadata?.order_id === row.trial.billing.orderId
      && payment.metadata?.billing_mode === row.trial.billing.mode) {
      const b = row.trial.billing;
      const current = !b.lastPayment || Date.parse(payment.created_at) >= Date.parse(b.lastPayment.createdAt);
      if (current && payment.status === 'succeeded') {
        const next = { ...row.trial, billing: { ...b } };
        const fullyRefunded = payment.refunds?.some(v => v.status === 'succeeded' && v.is_partial === false);
        const coversCurrentPeriod = payment.service_periods?.some(v => v.subscription_id === subId
          && Date.parse(v.ends_at) >= Date.parse(b.paidThrough));
        if ((fullyRefunded || event.type === 'dispute.lost') && coversCurrentPeriod && (next.license || next.kind === 'personal-purchase')) {
          await suspendSubscription(env, store, row, next, release, now, fetcher, fullyRefunded ? 'refunded' : 'disputed');
        } else {
          await store.save(row, next);
        }
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
  if (path === '/api/billing/personal-trial' && request.method === 'POST') {
    if (!config.trial) reject(404, 'not_found');
    const principal = await customerPrincipal(request, env, store, now);
    if (principal?.kind !== 'email' || !personalBuyerAllowed(env, principal.email)) reject(401, 'access_required');
    const value = await input(request); fields(value, ['acceptTerms', 'checkOnly']);
    if (!await store.allow('personal-trial-checkout', principal.email, 20, 3600000)) reject(429, 'rate_limited');
    if (value.checkOnly === true) {
      const row = await store.get(await personalTrialId(store, config.mode, principal.email));
      if (row?.contact?.email !== principal.email || row.trial?.kind !== 'personal-trial') reject(404, 'not_found');
      await confirmPersonalTrial(env, store, row, now, fetcher);
      return { requestId: row.id, ready: row.trial.state === 'approved' };
    }
    if (value.acceptTerms !== true) reject(400, 'terms_required');
    return startPersonalTrial(env, store, principal, config, release, now, fetcher, safeLink);
  }
  if (path === '/api/billing/personal-order' && request.method === 'POST') {
    const principal = await customerPrincipal(request, env, store, now);
    if (principal?.kind !== 'email' || !personalBuyerAllowed(env, principal.email)) reject(401, 'access_required');
    const value = await input(request); fields(value, ['acceptTerms', 'convertRequestId']);
    if (value.acceptTerms !== true) reject(400, 'terms_required');
    const plan = config.plans['personal-annual'];
    if (plan?.plan !== 'personal') reject(404, 'not_found');
    // Preserve historical 0/1 order identities across the first stable release.
    const majors = plan.majorVersion <= 1 ? [0, 1] : [plan.majorVersion];
    const ids = await Promise.all(majors.map(async major => hash(await limitIdentity(store.limiterKey,
      `personal-order:${config.mode}:${major}:${principal.email}`))));
    const orders = await Promise.all(ids.map(id => store.get(id)));
    const existing = orders.find(Boolean);
    const id = existing?.id ?? ids[0];
    if (existing && (existing.trial.conversionSourceId ?? null) !== (value.convertRequestId ?? null)) reject(409, 'order_already_exists');
    if (!existing) {
      let conversion = {};
      if (value.convertRequestId !== undefined) {
        if (config.mode !== 'live_mode' || !/^[a-f0-9]{64}$/.test(value.convertRequestId ?? '')) reject(409, 'conversion_unavailable');
        const source = await store.get(value.convertRequestId);
        if (!await customerCanAccess(request, env, store, source, now, 'billing')
          || !convertibleInstallation(source.trial, plan)) reject(409, 'conversion_unavailable');
        conversion = { conversionSourceId: source.id, conversionInstallationId: source.trial.installationId };
      }
      const { catalogue, identity } = await release(env);
      if (!compatiblePersonalMajor(plan.majorVersion, serverMajor(catalogue))) reject(409, 'licensed_major_unavailable');
      await store.insertOrder(id, { email: principal.email, plan: 'personal', name: principal.email }, {
        kind: 'personal-purchase', state: 'approved', maxUsers: plan.maxUsers, serverMajorVersion: plan.majorVersion,
        termsAcceptedAt: iso(now), sourceRevision: catalogue.sourceRevision, releaseHash: identity,
        ...conversion,
        tokenHash: await hash(token()), linkExpiresAt: iso(now),
        billing: { mode: config.mode, planSlug: 'personal-annual', productId: plan.productId,
          status: 'offered', orderId: crypto.randomUUID() },
      });
    }
    return { requestId: id };
  }
  if (path === '/api/access-admin/billing/plans' && request.method === 'GET') {
    return { mode: config.mode, plans: Object.entries(config.plans).map(([id, value]) => ({ id, maxUsers: value.maxUsers, plan: value.plan })) };
  }
  if (path === '/api/access-admin/billing/health' && request.method === 'GET') {
    return { reconciliation: await store.db.prepare('SELECT checked_at, checked, failed FROM billing_health WHERE singleton = 1').first(),
      pendingEvents: (await store.db.prepare('SELECT COUNT(*) AS count FROM billing_events WHERE processed_at IS NULL').first()).count };
  }
  if (path === '/api/access-admin/billing/coupons' && request.method === 'GET') {
    const page = Number(new URL(request.url).searchParams.get('page') ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) reject(400, 'invalid_page');
    const response = await dodo(env, '/discounts?page_size=50&page_number=' + page, 'GET', undefined, fetcher);
    if (!Array.isArray(response.items)) throw Error('Invalid coupon directory response');
    return { mode: config.mode, page, hasMore: response.items.length === 50, coupons: response.items.map(item => ({
      id: item.discount_id, code: item.code, type: item.type, amount: item.amount,
      expiresAt: item.expires_at, startsAt: item.starts_at, usageLimit: item.usage_limit, used: item.times_used,
      cycles: item.subscription_cycles, restricted: Boolean(item.restricted_to?.length), plans: Object.entries(config.plans).filter(([,p]) => item.restricted_to?.includes(p.productId)).map(([id])=>id),
      status: item.expires_at && Date.parse(item.expires_at) <= now ? 'Expired' : item.usage_limit && item.times_used >= item.usage_limit ? 'Exhausted' : item.starts_at && Date.parse(item.starts_at) > now ? 'Scheduled' : 'Available'
    })) };
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
  const match = /^\/api\/(?:access-admin\/)?billing\/([a-f0-9]{64})(?:\/(offer|checkout|portal|cancel|refresh|license|payments|recover-checkout|rotate-refresh|client-link))?$/.exec(path);
  if (!match) reject(404, 'not_found');
  const [, id, action] = match;
  const row = await store.get(id), record = row?.trial;
  if (!record || record.state !== 'approved' || (['offer', 'checkout', 'license'].includes(action) && (record.replacementRequest || record.revocation))) reject(404, 'not_found');
  const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  // Machine refresh credentials cannot open checkout or customer billing sessions.
  const machine = ['refresh','client-link'].includes(action) && record.billing?.refreshHash && await equal(await hash(bearer ?? ''), record.billing.refreshHash);
  if (action === 'refresh' && request.method === 'POST' && !request.headers.has('origin') && !machine) reject(401, 'access_required');
  const portalAuthorized = !admin && !machine && await customerCanAccess(request, env, store, row, now, 'billing');
  if (!admin && !machine && !portalAuthorized && (!bearer || !await equal(await hash(bearer), record.tokenHash)
    || Date.parse(record.linkExpiresAt) <= now)) reject(401, 'access_required');
  if (action==='client-link' && request.method==='POST' && (machine||portalAuthorized||admin)) {
    const value=await input(request); fields(value,['revoke']);
    return issueClientLink(store,row,env,now,{revoke:value.revoke===true});
  }
  if (admin && action === 'offer' && request.method === 'POST') {
    const v = await input(request); fields(v, ['plan']); const plan = config.plans[v.plan];
    if (plan?.plan !== 'commercial' || ['development', 'personal-purchase', 'personal-trial'].includes(record.kind)) reject(409, 'offer_unavailable');
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
    await store.save(row, { ...record, billing: { ...record.billing, refreshHash: await hash(refreshToken),
      ...(record.kind === 'personal-purchase' ? { refreshToken } : {}) } });
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
  if (!action && request.method === 'GET') return {
    ...publicStatus(record.billing), mode: record.billing.mode, hasLicense: Boolean(record.license),
    accessReady: record.kind !== 'personal-purchase' || paidPersonalAccess(record, now),
    hasCustomerPortal: Boolean(record.billing.customerId), hasSubscription: Boolean(record.billing.subscriptionId),
    canResubscribe: canResubscribe(record),
    canRetryPayment: record.kind === 'personal-purchase' && record.billing.status === 'failed'
      && Boolean(record.billing.subscriptionId) && !record.billing.paidThrough && !record.license && !record.billing.suspended,
  };
  if (action === 'checkout' && request.method === 'POST' && !admin) {
    const v = await input(request); fields(v, ['coupon', 'acceptTerms']);
    if (v.coupon !== undefined && !/^[A-Za-z0-9_-]{3,16}$/.test(v.coupon)) reject(400, 'invalid_coupon');
    const personal = record.kind === 'personal-purchase';
    if (personal && !portalAuthorized) reject(403, 'access_required');
    if (record.billing.mode !== config.mode || config.plans[record.billing.planSlug]?.productId !== record.billing.productId) reject(409, 'checkout_unavailable');
    let billing = record.billing;
    let billingHistory = record.billingHistory;
    if (billing.status === 'checkout_pending' && billing.checkoutUrl) return { checkoutUrl: safeLink(billing.checkoutUrl) };
    if (canResubscribe(record)) {
      const initialFailure = billing.status === 'failed' && !billing.paidThrough && !record.license;
      if (!initialFailure && v.acceptTerms !== true) reject(400, 'terms_required');
      await syncSubscription(env, store, row, release, now, fetcher);
      const previous = row.trial.billing;
      if (!canResubscribe(row.trial)) reject(409, 'checkout_unavailable');
      // Confirm the former subscription is terminal before creating a fresh charge.
      // Keep the installation, signed license and renewal token; ignore late former-order events.
      billingHistory = [...(billingHistory ?? []), { subscriptionId: previous.subscriptionId, orderId: previous.orderId }];
      billing = { mode: previous.mode, planSlug: previous.planSlug, productId: previous.productId,
        status: 'offered', orderId: crypto.randomUUID(),
        ...(previous.refreshToken ? { refreshToken: previous.refreshToken, refreshHash: previous.refreshHash } : {}) };
    }
    if (billing.status !== 'offered' || (!personal && !record.installationId)) reject(409, 'checkout_unavailable');
    if (record.conversionSourceId && !record.installationId) {
      const source = await store.get(record.conversionSourceId);
      if (config.mode !== 'live_mode' || !await customerCanAccess(request, env, store, source, now, 'billing')
        || !convertibleInstallation(source.trial, config.plans[billing.planSlug])
        || source.trial.installationId !== record.conversionInstallationId) reject(409, 'conversion_unavailable');
    }
    // Reserve durably before calling the provider. An ambiguous timeout must be reconciled by an operator, never retried into a duplicate subscription.
    await store.save(row, { ...row.trial, ...(v.acceptTerms === true ? { termsAcceptedAt: iso(now) } : {}), ...(billingHistory ? { billingHistory } : {}),
      billing: { ...billing, status: 'checkout_pending', checkoutStartedAt: iso(now) } });
    let result;
    try { result = await dodo(env, '/checkouts', 'POST', {
      product_cart: [{ product_id: billing.productId, quantity: 1 }],
      customer: { email: row.contact.email }, subscription_data: { trial_period_days: 0 },
      metadata: { access_request_id: id, order_id: billing.orderId, billing_mode: config.mode },
      ...(v.coupon ? { discount_codes: [v.coupon.toUpperCase()] } : {}),
      feature_flags: { allow_discount_code: true, allow_customer_editing_email: false }, return_url: `${customerOrigin}/portal?billing=return&request=${id}`,
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
    await store.save(row, { ...row.trial, billing: { ...row.trial.billing, sessionId: result.session_id, ...(personal ? { checkoutUrl } : {}) } });
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

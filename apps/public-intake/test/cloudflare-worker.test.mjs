import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { verifyLicenseFile, verifyLicenseRevocationFile } from '../../server/src/license-status.mjs';
import { encryptionKey, limiterKey, seal, unseal } from '../cloudflare/crypto.mjs';
import { TrialStore } from '../cloudflare/store.mjs';
import { handleRequest, prune } from '../cloudflare/worker.mjs';
import { stageAssets } from '../../../scripts/cloudflare/config.mjs';
import { issueSelfHostedLicense } from '../../../scripts/ops/issue-self-hosted-license.mjs';
import { handleBilling, syncSubscription, billingWebhook, reconcileBilling } from '../cloudflare/billing.mjs';
import { verifyWebhook } from '../cloudflare/dodo.mjs';
import { issuer, hash } from '../cloudflare/crypto.mjs';
import { handleCustomerPortal } from '../cloudflare/customer-portal.mjs';
import intake from '../cloudflare/intake-only.mjs';
import { siteSecrets } from '../../../scripts/cloudflare/sites.mjs';

const origin = 'https://trial.example.com';
const admin = '/api/access-admin/requests';
const root = fileURLToPath(new URL('../../../', import.meta.url));

test('support submissions reach the private inbox and cannot be approved for access', async t => {
  const f = await fixture(t);
  const keys = await siteSecrets('intake', { INTAKE_KEY: f.intakeKey });
  const input = { plan: 'support', email: 'visitor@example.com', contactName: 'Visitor',
    message: 'How do I update my installation?', website: '', consent: true };
  const submit = payload => intake.fetch(new Request(origin + '/api/waitlist', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }), { ...f.env, ...keys });
  assert.equal((await submit({ ...input, message: '' })).status, 400);
  assert.equal((await submit(input)).status, 202);
  assert.equal((await f.get(admin)).status, 401);
  const { requests: [row] } = await (await f.get(admin, f.operatorToken)).json();
  assert.equal(row.message, input.message);
  assert.equal(row.plan, 'support');
  assert.equal((await f.post(`${admin}/${row.id}/approve`, { maxUsers: 5 }, f.operatorToken)).status, 409);
  assert.equal((await f.post(`${admin}/${row.id}/approve-development`, {}, f.operatorToken)).status, 409);
});

test('customer sign-in uses only mocked Resend while development-only identities retain manual delivery', { timeout: 15000 }, async t => {
  const messages = [];
  const f = await fixture(t, { bindings: { SITE_SURFACE: 'customer', CUSTOMER_PORTAL_ENABLED: '1', CUSTOMER_EMAIL_PROVIDER: 'resend',
    CUSTOMER_EMAIL_MODE: 'production', CUSTOMER_EMAIL_FROM: 'accounts@127vaults.com', RESEND_API_KEY: 're_' + 'fake'.repeat(8) },
    outboundService: async request => { assert.equal(request.url, 'https://api.resend.com/emails'); messages.push(await request.json()); return Response.json({ id: `fake-${messages.length}` }); } });
  const store = new TrialStore(f.db, await encryptionKey(f.intakeKey, 'contacts'), await encryptionKey(f.intakeKey, 'trials'), () => Date.now(), await limiterKey(f.intakeKey));
  await store.insert('a'.repeat(64), { ...f.requestInput, email: 'customer@customer-domain.dev' });
  const started = await f.post('/api/customer/start', { email: 'customer@customer-domain.dev' });
  assert.equal(started.status, 202); const challenge = await started.json(); assert.equal(challenge.code, undefined);
  assert.equal(messages.length, 1); const code = /code is (\d{6})/.exec(messages[0].text)[1];
  assert.equal((await f.post('/api/customer/complete', { challengeId: challenge.challengeId, code })).status, 200);
  await store.insert('b'.repeat(64), { ...f.requestInput, email: 'developer@customer-domain.dev' });
  const developer = await store.get('b'.repeat(64)); await store.save(developer, { kind: 'development', state: 'approved' });
  assert.equal((await f.post('/api/customer/start', { email: 'developer@customer-domain.dev' })).status, 202);
  assert.equal(messages.length, 1);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM customer_manual_mail').first()).n, 1);
});

test('customer approval and access notices use mocked Resend once; development invitations never use its transport', { timeout: 15000 }, async t => {
  const messages = [];
  const f = await fixture(t, { bindings: { SITE_SURFACE: 'admin', CUSTOMER_EMAIL_PROVIDER: 'resend', CUSTOMER_EMAIL_MODE: 'production',
    CUSTOMER_EMAIL_FROM: 'accounts@127vaults.com', RESEND_API_KEY: 're_' + 'fake'.repeat(8), CUSTOMER_EMAIL_STORAGE: '1' },
    outboundService: async request => {
      assert.equal(request.url, 'https://api.resend.com/emails');
      messages.push(await request.json()); return Response.json({ id: `mock-only-${messages.length}` });
    } });
  const store = new TrialStore(f.db, await encryptionKey(f.intakeKey, 'contacts'), await encryptionKey(f.intakeKey, 'trials'), () => Date.now(), await limiterKey(f.intakeKey));
  const id = 'c'.repeat(64); await store.insert(id, { ...f.requestInput, email: 'customer@customer-domain.dev' });
  const approved = await f.approve(id);
  const waitForCount = async count => {
    const until = Date.now() + 4000;
    while (Date.now() < until) {
      const row = await f.db.prepare("SELECT count(*) AS n FROM customer_email_receipts WHERE state = 'queued'").first();
      if (row.n === count) return;
      await new Promise(done => setTimeout(done, 20));
    }
    throw Error('Mock email was not recorded');
  };
  await waitForCount(1); assert.equal(messages.length, 1); assert.match(messages[0].text, new RegExp(approved.token));
  let review = await (await f.get(admin, f.operatorToken)).json();
  assert.equal(review.automaticCustomerEmail, true);
  assert.equal(review.requests.find(row => row.id === id).customerNotifications.invitation, 'queued');
  assert.equal((await f.post(`${admin}/${id}/send-invitation`, {}, f.operatorToken)).status, 200);
  assert.equal(messages.length, 1);
  assert.equal((await f.post(`${admin}/${id}/close`, {}, f.operatorToken)).status, 200);
  await waitForCount(2); assert.match(messages[1].subject, /access request/);
  review = await (await f.get(admin, f.operatorToken)).json();
  assert.equal(review.requests.find(row => row.id === id).customerNotifications.access, 'queued');
  const internalId = 'd'.repeat(64); await store.insert(internalId, { ...f.requestInput, email: 'developer@customer-domain.dev' });
  const row = await store.get(internalId);
  await store.save(row, { state: 'approved', kind: 'development', tokenHash: await hash('A'.repeat(43)),
    linkExpiresAt: new Date(Date.now() + 86400000).toISOString(), serverMajorVersion: 0,
    invitation: { subject: 'Development access', text: 'Internal use only' } });
  assert.equal((await f.post(`${admin}/${internalId}/send-invitation`, {}, f.operatorToken)).status, 409);
  assert.equal(messages.length, 2);
});

async function billingFixture(t, outboundService) {
  const f = await fixture(t, { outboundService, bindings: { DODO_ENABLED: '1', DODO_MODE: 'test_mode', DODO_API_KEY: 'test-key',
    DODO_WEBHOOK_SECRET: 'whsec_' + Buffer.alloc(32, 7).toString('base64'), DODO_BUSINESS_ID: 'biz_test',
    DODO_PLANS: JSON.stringify({ 'commercial-monthly': { productId: 'pdt_test', plan: 'commercial', maxUsers: 8 } }) } });
  const id = await f.submit(), a = await f.approve(id), installationId = randomUUID();
  assert.equal((await f.post(`${a.base}/activate`, { installationId }, a.token)).status, 200);
  const store = new TrialStore(f.db, await encryptionKey(f.intakeKey, 'contacts'), await encryptionKey(f.intakeKey, 'trials'), () => Date.now(), await limiterKey(f.intakeKey));
  const release = async () => ({ signingKey: await issuer(f.bindings.TRIAL_ISSUER_PRIVATE_KEY, f.publicKeys.trial) });
  const req = (path, value, bearer = a.token) => new Request(origin + path, { method: value === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Origin: origin },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const offer = await handleBilling(req(`/api/access-admin/billing/${id}/offer`, { plan: 'commercial-monthly' }), f.env, store, release, Date.now(), true);
  const b = (await store.get(id)).trial.billing;
  const sub = { subscription_id: 'sub_test', status: 'active', product_id: 'pdt_test', quantity: 1, trial_period_days: 0,
    customer: { customer_id: 'cus_test' }, metadata: { access_request_id: id, order_id: b.orderId, billing_mode: 'test_mode' },
    next_billing_date: new Date(Date.now() + 31 * 86400000).toISOString() };
  return { ...f, id, a, store, release, req, offer, sub, installationId };
}

test('Dodo private checkout binds the server plan, reserves once, and never trusts redirect or browser pricing', async t => {
  const f = await billingFixture(t); let calls = 0;
  const provider = async (url, options) => {
    calls++; assert.equal(url, 'https://test.dodopayments.com/checkouts');
    const v = JSON.parse(options.body); assert.deepEqual(v.product_cart, [{ product_id: 'pdt_test', quantity: 1 }]);
    assert.equal(v.subscription_data.trial_period_days, 0); assert.deepEqual(v.discount_codes, ['FRIEND']);
    return Response.json({ checkout_url: 'https://checkout.dodopayments.com/buy/test', session_id: 'cks_test' });
  };
  const route = `/api/billing/${f.id}/checkout`;
  await assert.rejects(handleBilling(f.req(route, { price: 1 }), f.env, f.store, f.release, Date.now(), false, provider));
  assert.equal((await handleBilling(f.req(route, { coupon: 'FRIEND' }), f.env, f.store, f.release, Date.now(), false, provider)).checkoutUrl, 'https://checkout.dodopayments.com/buy/test');
  await assert.rejects(handleBilling(f.req(route, {}), f.env, f.store, f.release, Date.now(), false, provider), /checkout_unavailable/);
  assert.equal(calls, 1);
  const row = await f.store.get(f.id); assert.equal(row.trial.billing.status, 'checkout_pending');
  assert.equal(verifyLicenseFile(row.trial.license, f.publicKeys, f.installationId).sequence, 1);
});

test('Dodo customer portal sessions can manage billing and cancel only their owned subscription without an invitation bearer', async t => {
  const f = await billingFixture(t), env = { ...f.env, CUSTOMER_PORTAL_ENABLED: '1' }, now = Date.now();
  await syncSubscription(env, f.store, await f.store.get(f.id), f.release, now, async () => Response.json(f.sub), 'sub_test');
  const session = await handleCustomerPortal(new Request(origin + '/api/customer/invitation', { method: 'POST', body: JSON.stringify({ requestId: f.id, token: f.a.token }) }), env, f.store, now);
  const cookie = session.headers.get('set-cookie'); let cancelCalls = 0;
  const provider = async (url, options) => {
    if (url.includes('/customer-portal/session')) return Response.json({ link: 'https://customer.dodopayments.com/test' });
    if (options.method === 'PATCH') { assert.deepEqual(JSON.parse(options.body), { cancel_at_next_billing_date: true }); cancelCalls++; }
    return Response.json({ ...f.sub, cancel_at_next_billing_date: cancelCalls > 0 });
  };
  const request = action => new Request(origin + `/api/billing/${f.id}/${action}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await handleBilling(request('portal'), env, f.store, f.release, now, false, provider)).portalUrl, 'https://customer.dodopayments.com/test');
  const before = (await f.store.get(f.id)).trial.license;
  assert.equal((await handleBilling(request('cancel'), env, f.store, f.release, now, false, provider)).cancelAtPeriodEnd, true);
  assert.equal(cancelCalls, 1); assert.equal((await f.store.get(f.id)).trial.license, before);
  const grantResponse = await handleCustomerPortal(new Request(origin + '/api/customer/installer-link', { method: 'POST',
    headers: { Cookie: cookie }, body: JSON.stringify({ requestId: f.id }) }), env, f.store, now);
  const grant = (await grantResponse.json()).link.split('.').at(-1);
  const installer = await handleCustomerPortal(new Request(origin + '/api/customer/invitation', { method: 'POST',
    body: JSON.stringify({ requestId: f.id, token: grant }) }), env, f.store, now);
  const restricted = new Request(origin + `/api/billing/${f.id}/cancel`, { method: 'POST', headers: { Cookie: installer.headers.get('set-cookie') }, body: '{}' });
  await assert.rejects(handleBilling(restricted, env, f.store, f.release, now, false, provider), /access_required/);
  await f.db.prepare('DELETE FROM customer_sessions').run();
  await assert.rejects(handleBilling(request('portal'), env, f.store, f.release, now, false, provider), /access_required/);
});

test('Cloud-only control owners can use manual Manage sign-in and see only their Cloud directory', async t => {
  const f = await billingFixture(t);
  const now = Date.now();
  const env = { ...f.env, CUSTOMER_PORTAL_ENABLED: '1', CLOUD_CUSTOMER_PILOT_MANUAL_LOGIN: '1',
    CLOUD_CUSTOMER_DIRECTORY_ORIGIN: 'https://directory.example.com', CLOUD_CUSTOMER_DIRECTORY_TOKEN: 'a'.repeat(64) };
  const email = 'cloud-only@example.com';
  const tenant = { slug: 'family', state: 'active', maxActiveUsers: 3, canonicalUrl: 'https://cloud.127vaults.com/t/family/' };
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, env.CLOUD_CUSTOMER_DIRECTORY_ORIGIN + '/internal/cloud/v1/customer-tenants');
    assert.equal(options.headers.Authorization, 'Bearer ' + env.CLOUD_CUSTOMER_DIRECTORY_TOKEN);
    assert.deepEqual(JSON.parse(options.body), { email });
    return Response.json({ tenants: [tenant] });
  });
  const request = (path, input, cookie) => handleCustomerPortal(new Request(origin + '/api/customer/' + path, {
    method: input ? 'POST' : 'GET', headers: cookie ? { Cookie: cookie } : {},
    body: input && JSON.stringify(input)
  }), env, f.store, now);
  const invitation = await request('invitation', { requestId: f.id, token: f.a.token });
  const invitationAccount = await (await request('me', null, invitation.headers.get('set-cookie'))).json();
  assert.deepEqual(invitationAccount.cloudTenants, []);
  assert.equal(fetch.mock.callCount(), 0);
  const started = await (await request('start', { email })).json();
  const message = await f.db.prepare('SELECT payload FROM customer_manual_mail WHERE id=?').bind(started.challengeId).first();
  const mail = await unseal(message.payload, await encryptionKey(env.INTAKE_KEY, 'customer-portal'), `manual-customer-mail:${started.challengeId}`);
  const code = /code is (\d{6})/.exec(mail.text)[1];
  const verified = await request('complete', { challengeId: started.challengeId, code });
  const account = await (await request('me', null, verified.headers.get('set-cookie'))).json();
  assert.deepEqual(account.cloudTenants, [tenant]);
  assert.deepEqual(account.requests, []);
  assert.equal(fetch.mock.callCount(), 2);
});

test('Dodo confirmed renewal issues a higher signed license; failure never extends expiry and grace ends in cancellation', async t => {
  const f = await billingFixture(t); let cancels = 0;
  const provider = async (_url, options) => { if (options.method === 'PATCH') cancels++; return Response.json(f.sub); };
  await syncSubscription(f.env, f.store, await f.store.get(f.id), f.release, Date.now(), provider, 'sub_test');
  let row = await f.store.get(f.id), license = verifyLicenseFile(row.trial.license, f.publicKeys, f.installationId);
  assert.equal(license.sequence, 2); assert.equal(license.plan, 'commercial'); assert.equal(license.maxActiveUsers, 8);
  assert.equal(license.expiresAt, f.sub.next_billing_date);
  await syncSubscription(f.env, f.store, row, f.release, Date.now(), provider);
  assert.equal((await f.store.get(f.id)).trial.license, row.trial.license);
  f.sub.status = 'on_hold';
  await syncSubscription(f.env, f.store, await f.store.get(f.id), f.release, Date.now(), provider);
  assert.equal((await f.store.get(f.id)).trial.license, row.trial.license);
  const later = Date.parse(license.expiresAt) + 30 * 86400000;
  const result = await reconcileBilling(f.env, f.store, f.release, later, provider);
  assert.deepEqual(result, { checked: 1, failed: 0 }); assert.equal(cancels, 1);
  assert.equal((await f.store.get(f.id)).trial.billing.status, 'cancelled');
  f.sub.status = 'active'; f.sub.next_billing_date = new Date(later + 31 * 86400000).toISOString();
  await syncSubscription(f.env, f.store, await f.store.get(f.id), f.release, later, provider);
  row = await f.store.get(f.id); assert.equal(verifyLicenseFile(row.trial.license, f.publicKeys, f.installationId).sequence, 3);
});

test('Dodo rejects cross-order, product, customer, environment and trial subscription substitutions', async t => {
  const f = await billingFixture(t);
  for (const change of [{ product_id: 'pdt_other' }, { quantity: 2 }, { trial_period_days: 7 },
    { metadata: { ...f.sub.metadata, order_id: 'other' } }, { metadata: { ...f.sub.metadata, billing_mode: 'live_mode' } }]) {
    await assert.rejects(syncSubscription(f.env, f.store, await f.store.get(f.id), f.release, Date.now(), async () => Response.json({ ...f.sub, ...change }), 'sub_test'), /binding/);
  }
  assert.equal(verifyLicenseFile((await f.store.get(f.id)).trial.license, f.publicKeys, f.installationId).sequence, 1);
  const machine = f.req(`/api/billing/${f.id}/portal`, {}, f.offer.refreshToken);
  await assert.rejects(handleBilling(machine, f.env, f.store, f.release, Date.now(), false), /access_required/);
});

test('Dodo Standard Webhooks verifies raw bytes, freshness and account; durable replay is idempotent', async t => {
  const f = await billingFixture(t), now = Date.now(), id = 'msg_test';
  const event = { business_id: 'biz_test', type: 'subscription.active', timestamp: new Date(now).toISOString(), data: f.sub };
  const signed = async (eventBody = event, time = Math.floor(now / 1000), rawOverride) => {
    const raw = JSON.stringify(eventBody), key = await crypto.subtle.importKey('raw', Buffer.alloc(32, 7), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${time}.${raw}`))).toString('base64');
    return new Request(origin + '/api/billing/webhook', { method: 'POST', headers: { 'webhook-id': id, 'webhook-timestamp': String(time), 'webhook-signature': `v1,${signature}` }, body: rawOverride ?? raw });
  };
  await assert.rejects(verifyWebhook(await signed(event, Math.floor(now / 1000) - 301), f.env, now), /signature/);
  await assert.rejects(verifyWebhook(await signed(event, undefined, JSON.stringify(event) + ' '), f.env, now), /signature/);
  await assert.rejects(verifyWebhook(await signed({ ...event, business_id: 'other' }), f.env, now), /event/);
  let calls = 0; const provider = async () => { calls++; return Response.json(f.sub); };
  await billingWebhook(await signed(), f.env, f.store, f.release, now, provider);
  const license = (await f.store.get(f.id)).trial.license;
  await billingWebhook(await signed(), f.env, f.store, f.release, now, provider);
  assert.equal(calls, 1); assert.equal((await f.store.get(f.id)).trial.license, license);
  const ledger = await f.db.prepare('SELECT * FROM billing_events WHERE id = ?').bind(id).first();
  assert.equal(ledger.processed_at, now); assert.ok(!ledger.event.includes('cus_test'));
  const eventId = 'msg_retry', retryRaw = JSON.stringify(event), retryTime = String(Math.floor(now / 1000));
  const retryKey = await crypto.subtle.importKey('raw', Buffer.alloc(32, 7), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const retrySignature = Buffer.from(await crypto.subtle.sign('HMAC', retryKey, new TextEncoder().encode(`${eventId}.${retryTime}.${retryRaw}`))).toString('base64');
  const retryRequest = new Request(origin + '/api/billing/webhook', { method: 'POST', body: retryRaw,
    headers: { 'webhook-id': eventId, 'webhook-timestamp': retryTime, 'webhook-signature': `v1,${retrySignature}` } });
  await assert.rejects(billingWebhook(retryRequest, f.env, f.store, f.release, now, async () => { throw Error('provider down'); }));
  assert.equal((await f.db.prepare('SELECT processed_at FROM billing_events WHERE id = ?').bind(eventId).first()).processed_at, null);
  await reconcileBilling(f.env, f.store, f.release, now + 3600000, provider);
  assert.ok((await f.db.prepare('SELECT processed_at FROM billing_events WHERE id = ?').bind(eventId).first()).processed_at);
});

test('Dodo operator coupons enforce plan scope, bounded redemptions, cycles and free or nominal discounts', async t => {
  const f = await billingFixture(t), route = '/api/access-admin/billing/coupons'; let calls = 0;
  const value = { plan: 'commercial-monthly', basisPoints: 10000, cycles: 12, usageLimit: 1, expiresAt: new Date(Date.now() + 86400000).toISOString() };
  const provider = async (url, options) => { calls++; assert.equal(url, 'https://test.dodopayments.com/discounts');
    const v = JSON.parse(options.body); assert.equal(v.amount, 10000); assert.equal(v.subscription_cycles, 12);
    assert.deepEqual(v.restricted_to, ['pdt_test']); assert.equal(v.usage_limit, 1);
    return Response.json({ code: v.code, discount_id: 'dis_test' }); };
  await assert.rejects(handleBilling(f.req(route, value), f.env, f.store, f.release, Date.now(), false, provider), /access_required/);
  await assert.rejects(handleBilling(f.req(route, { ...value, basisPoints: 10001 }), f.env, f.store, f.release, Date.now(), true, provider), /coupon/);
  const result = await handleBilling(f.req(route, value), f.env, f.store, f.release, Date.now(), true, provider);
  assert.match(result.code, /^[A-Z0-9]{16}$/); assert.equal(calls, 1);
});

test('Dodo Worker HTTP boundary keeps checkout private, rejects cross-origin changes, and authenticates webhooks without browser Origin', async t => {
  const f = await billingFixture(t);
  assert.equal((await f.post(`/api/billing/${f.id}/checkout`, {}, f.a.token, 'https://other.example.com')).status, 403);
  assert.equal((await f.get(`/api/billing/${f.id}`, 'x'.repeat(43))).status, 401);
  assert.equal((await f.get(`/api/billing/${f.id}`, f.a.token)).status, 200);
  assert.equal((await f.get('/api/access-admin/billing/plans')).status, 401);
  assert.equal((await f.get('/api/access-admin/billing/plans', f.operatorToken)).status, 200);
  const wrong = await f.mf.dispatchFetch(origin + '/api/billing/webhook', { method: 'POST', body: '{}' });
  assert.equal(wrong.status, 401);
  const now = Date.now(), timestamp = String(Math.floor(now / 1000)), id = 'msg_http';
  const raw = JSON.stringify({ business_id: 'biz_test', type: 'payment.processing', timestamp: new Date(now).toISOString(), data: {} });
  const key = await crypto.subtle.importKey('raw', Buffer.alloc(32, 7), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`))).toString('base64');
  const accepted = await f.mf.dispatchFetch(origin + '/api/billing/webhook', { method: 'POST', body: raw,
    headers: { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` } });
  assert.equal(accepted.status, 200, await accepted.clone().text());
  assert.equal((await f.post(`${admin}/${f.id}/extend`, { days: 1 }, f.operatorToken)).status, 409);
  assert.equal((await f.get(f.a.base, f.a.token)).status, 200);
});

test('Dodo checkout calls the mock provider from the Worker runtime', async t => {
  let calls = 0;
  const checkoutUrl = 'https://checkout.dodopayments.com/buy/fixture';
  const f = await billingFixture(t, async request => {
    calls++;
    assert.equal(request.url, 'https://test.dodopayments.com/checkouts');
    assert.equal(request.headers.get('authorization'), 'Bearer test-key');
    return Response.json({ checkout_url: checkoutUrl, session_id: 'cks_fixture' });
  });
  const response = await f.post(`/api/billing/${f.id}/checkout`, {}, f.a.token);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).checkoutUrl, checkoutUrl);
  assert.equal(calls, 1);
});

test('Dodo definite checkout rejection permits correction, while an ambiguous timeout preserves the reserved order', async t => {
  const f = await billingFixture(t), path = `/api/billing/${f.id}/checkout`;
  await assert.rejects(handleBilling(f.req(path, { coupon: 'INVALID' }), f.env, f.store, f.release, Date.now(), false,
    async () => new Response('{}', { status: 422 })), /checkout_rejected/);
  assert.equal((await f.store.get(f.id)).trial.billing.status, 'offered');
  await assert.rejects(handleBilling(f.req(path, {}), f.env, f.store, f.release, Date.now(), false,
    async () => { throw Error('network timeout'); }), /timeout/);
  assert.equal((await f.store.get(f.id)).trial.billing.status, 'checkout_pending');
});

test('Dodo installation replacement delivers a signed revocation to the retired server without binding it to the new installation', async t => {
  const f = await billingFixture(t), replacement = randomUUID();
  assert.equal((await f.post(`${f.a.base}/replacement-request`, { installationId: replacement, reason: 'Host replacement', retired: true }, f.a.token)).status, 202);
  const retired = await handleBilling(f.req(`/api/billing/${f.id}/refresh`, { installationId: f.installationId }, f.offer.refreshToken), f.env, f.store, f.release, Date.now(), false);
  const old = verifyLicenseFile(retired.license, f.publicKeys, f.installationId);
  assert.equal(verifyLicenseRevocationFile(retired.revocation, f.publicKeys, f.installationId, old.licenseId).licenseId, old.licenseId);
  const result = await f.post(`${admin}/${f.id}/replace-installation`, { installationId: replacement, retired: true }, f.operatorToken);
  assert.equal(result.status, 200, await result.clone().text());
  const after = await handleBilling(f.req(`/api/billing/${f.id}/refresh`, { installationId: f.installationId }, f.offer.refreshToken), f.env, f.store, f.release, Date.now(), false);
  assert.equal(after.status, 'replaced'); assert.equal(after.license, retired.license); assert.equal(after.revocation, retired.revocation);
  const newLicense = verifyLicenseFile((await f.store.get(f.id)).trial.license, f.publicKeys, replacement);
  assert.equal(newLicense.sequence, old.sequence + 1);
});

test('Dodo full refund of the current payment revokes service and cancels collection without exposing provider data to the machine', async t => {
  const f = await billingFixture(t), now = Date.now(), timestamp = String(Math.floor(now / 1000)), id = 'msg_refund';
  await syncSubscription(f.env, f.store, await f.store.get(f.id), f.release, now, async () => Response.json(f.sub), 'sub_test');
  const raw = JSON.stringify({ business_id: 'biz_test', type: 'refund.succeeded', timestamp: new Date(now).toISOString(),
    data: { payment_id: 'pay_test', refund_id: 'ref_test' } });
  const key = await crypto.subtle.importKey('raw', Buffer.alloc(32, 7), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`))).toString('base64');
  let cancellations = 0;
  const provider = async (url, options) => {
    if (options.method === 'PATCH') { cancellations++; return Response.json({}); }
    if (url.includes('/payments/')) return Response.json({ subscription_id: 'sub_test', payment_id: 'pay_test',
      created_at: new Date(now).toISOString(), status: 'succeeded', total_amount: 1000, currency: 'USD',
      service_periods: [{ subscription_id: 'sub_test', starts_at: new Date(now).toISOString(), ends_at: f.sub.next_billing_date }],
      refunds: [{ status: 'succeeded', is_partial: false }] });
    return Response.json(f.sub);
  };
  await billingWebhook(new Request(origin + '/api/billing/webhook', { method: 'POST', body: raw,
    headers: { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` } }), f.env, f.store, f.release, now, provider);
  const row = await f.store.get(f.id), license = verifyLicenseFile(row.trial.license, f.publicKeys, f.installationId);
  assert.equal(cancellations, 1); assert.equal(row.trial.billing.status, 'refunded');
  assert.equal(verifyLicenseRevocationFile(row.trial.billing.revocation, f.publicKeys, f.installationId, license.licenseId).licenseId, license.licenseId);
  const result = await handleBilling(f.req(`/api/billing/${f.id}/refresh`, {}, f.offer.refreshToken), f.env, f.store, f.release, now, false, provider);
  assert.equal(result.revocation, row.trial.billing.revocation); assert.equal(result.customerId, undefined);
});
test('Dodo Personal signup, verified payment and installation binding require no approval', { timeout: 20000 }, async t => {
  const messages = [];
  const secret = Buffer.alloc(32, 7);
  const paidThrough = new Date(Date.now() + 365 * 86400000).toISOString();
  let metadata;
  let checkoutCalls = 0;
  const f = await fixture(t, { bindings: {
    SITE_SURFACE: 'customer', CUSTOMER_PORTAL_ENABLED: '1', CUSTOMER_EMAIL_PROVIDER: 'resend',
    CUSTOMER_EMAIL_MODE: 'production', CUSTOMER_EMAIL_FROM: 'accounts@127vaults.com', RESEND_API_KEY: 're_' + 'fake'.repeat(8),
    DODO_ENABLED: '1', DODO_MODE: 'live_mode', DODO_API_KEY: 'mock-key',
    DODO_WEBHOOK_SECRET: 'whsec_' + secret.toString('base64'), DODO_BUSINESS_ID: 'biz_personal',
    DODO_PLANS: JSON.stringify({ 'personal-annual': { productId: 'pdt_personal', plan: 'personal', majorVersion: 1, maxUsers: 5 } }),
  }, serverMajorVersion: 1, outboundService: async request => {
    const url = new URL(request.url);
    if (url.hostname === 'api.resend.com') {
      messages.push(await request.json());
      return Response.json({ id: 'mock-mail' });
    }
    assert.equal(url.origin, 'https://live.dodopayments.com');
    if (url.pathname === '/checkouts') {
      checkoutCalls++;
      const input = await request.json();
      metadata = input.metadata;
      assert.deepEqual(input.product_cart, [{ product_id: 'pdt_personal', quantity: 1 }]);
      assert.equal(input.return_url, `${origin}/portal?billing=return&request=${metadata.access_request_id}`);
      return Response.json({ session_id: 'cks_personal', checkout_url: 'https://checkout.dodopayments.com/session' });
    }
    if (url.pathname === '/subscriptions/sub_personal') return Response.json({
      subscription_id: 'sub_personal', status: 'active', metadata, product_id: 'pdt_personal',
      quantity: 1, trial_period_days: 0, customer: { customer_id: 'cus_personal' }, next_billing_date: paidThrough,
    });
    assert.equal(url.pathname, '/payments/pay_personal');
    return Response.json({ payment_id: 'pay_personal', subscription_id: 'sub_personal', status: 'succeeded',
      total_amount: 2000, currency: 'USD', created_at: new Date().toISOString() });
  } });
  const started = await (await f.post('/api/customer/start', { email: 'buyer@customer-domain.dev' })).json();
  assert.equal(messages.length, 1);
  const signedIn = await f.post('/api/customer/complete', { challengeId: started.challengeId, code: /code is (\d{6})/.exec(messages[0].text)[1] });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get('set-cookie').split(';')[0];
  const post = (path, input) => f.mf.dispatchFetch(origin + path, { method: 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal((await post('/api/billing/personal-order', { acceptTerms: false })).status, 400);
  const order = await post('/api/billing/personal-order', { acceptTerms: true });
  assert.equal(order.status, 200, await order.clone().text());
  const { requestId } = await order.json();
  assert.equal((await (await post('/api/billing/personal-order', { acceptTerms: true })).json()).requestId, requestId);
  const trial = `/api/trials/${requestId}`;
  const installationId = randomUUID();
  assert.equal((await post(`${trial}/activate`, { installationId })).status, 403);
  assert.equal((await post(`/api/billing/${requestId}/checkout`, {})).status, 200);
  assert.equal((await post(`/api/billing/${requestId}/checkout`, {})).status, 200);
  assert.equal(checkoutCalls, 1);
  const billing = await (await f.get(`/api/billing/${requestId}`, null, cookie)).json();
  assert.equal(billing.status, 'checkout_pending');
  assert.equal(billing.hasSubscription || billing.hasCustomerPortal || billing.hasLicense, false);
  const account = await (await f.get('/api/customer/me', null, cookie)).json();
  assert.equal(account.requests[0].billingMode, 'live_mode');
  assert.ok(account.requests[0].checkoutStartedAt);
  assert.equal((await f.get(`${trial}/artifacts/server`, null, cookie)).status, 403);
  const raw = JSON.stringify({ business_id: 'biz_personal', type: 'payment.succeeded', timestamp: new Date().toISOString(),
    data: { payment_id: 'pay_personal', metadata } });
  const id = 'msg_personal', timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`))).toString('base64');
  const webhook = new Request(origin + '/api/billing/webhook', { method: 'POST', body: raw,
    headers: { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` } });
  await billingWebhook(webhook, f.env, new TrialStore(f.db, await encryptionKey(f.intakeKey, 'contacts'),
    await encryptionKey(f.intakeKey, 'trials'), () => Date.now(), await limiterKey(f.intakeKey)), async () => {
    throw Error('A license cannot be issued before installation binding');
  }, Date.now(), requestUrl => f.mfOptions.outboundService(new Request(requestUrl)));
  assert.equal(await (await f.get(`${trial}/artifacts/server`, null, cookie)).text(), f.archive);
  const activated = await post(`${trial}/activate`, { installationId });
  assert.equal(activated.status, 200, await activated.clone().text());
  const file = await (await f.get(`${trial}/license`, null, cookie)).text();
  const license = verifyLicenseFile(file, f.publicKeys, installationId);
  assert.deepEqual([license.plan, license.majorVersion, license.maxActiveUsers, license.expiresAt], ['personal', 1, 5, paidThrough]);
  const refresh = await (await f.get(`${trial}/subscription`, null, cookie)).json();
  const machine = await f.mf.dispatchFetch(refresh.refreshUrl, { method: 'POST',
    headers: { Authorization: `Bearer ${refresh.refreshToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId }) });
  assert.equal(machine.status, 200);
  assert.equal((await machine.json()).license, file);
  assert.equal((await post(`${trial}/activate`, { installationId: randomUUID() })).status, 409);
});

async function fixture(t, options = {}) {
  const issuerPrivateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeys = { trial: createPublicKey(issuerPrivateKey).export({ type: 'spki', format: 'pem' }) };
  const operatorToken = randomBytes(32).toString('base64url'), intakeKey = randomBytes(32).toString('hex');
  const archive = 'synthetic private archive', sha256 = createHash('sha256').update(archive).digest('hex');
  const catalogue = { schemaVersion: 1, sourceRevision: 'a'.repeat(40), issuerPublicKeys: publicKeys,
    ...(options.serverMajorVersion === undefined ? {} : { serverMajorVersion: options.serverMajorVersion }),
    artifacts: [{ id: 'server', filename: 'server.tar', label: 'Server', sizeBytes: Buffer.byteLength(archive), sha256,
      objectKey: 'releases/test/server.tar', etag: createHash('md5').update(archive).digest('hex') }] };
  const catalogueSource = JSON.stringify(catalogue);
  const bindings = { PUBLIC_INTAKE_ORIGIN: origin, OPERATOR_TOKEN: operatorToken, INTAKE_KEY: intakeKey,
    TRIAL_ISSUER_KEY_ID: 'trial', TRIAL_ISSUER_PRIVATE_KEY: issuerPrivateKey, TRIAL_CATALOGUE_KEY: 'releases/test/catalogue.json',
    TRIAL_SOURCE_REVISION: 'a'.repeat(40), TRIAL_CATALOGUE_SHA256: createHash('sha256').update(catalogueSource).digest('hex'),
    ...(options.bindings ?? {}) };
  const mfOptions = { modules: true, modulesRoot: root, scriptPath: fileURLToPath(new URL('../cloudflare/worker.mjs', import.meta.url)),
    modulesRules: [{ type: 'ESModule', include: ['**/*.mjs'], fallthrough: true }],
    compatibilityDate: '2026-07-01', bindings, d1Databases: ['DB'], r2Buckets: ['ARTIFACTS'],
    ...(options.assetsDirectory ? { assets: { directory: options.assetsDirectory, binding: 'ASSETS',
      routerConfig: { has_user_worker: true, static_routing: { user_worker: ['/api/*'] } },
      assetConfig: { html_handling: 'drop-trailing-slash', not_found_handling: 'none' } } }
      : { serviceBindings: { ASSETS: () => new Response('static website') } }),
    ...(options.outboundService ? { outboundService: options.outboundService } : {}),
    ...(options.persistDirectory ? { d1Persist: join(options.persistDirectory, 'd1'), r2Persist: join(options.persistDirectory, 'r2') } : {}) };
  let mf;
  if (options.cliRuntime) {
    const require = createRequire(import.meta.url);
    const bundled = createRequire(require.resolve('wrangler/package.json'))('miniflare');
    const directory = fileURLToPath(new URL('../cloudflare/', import.meta.url));
    const paths = [mfOptions.scriptPath,
      ...(await readdir(directory)).filter(name => name.endsWith('.mjs') && name !== 'worker.mjs').map(name => join(directory, name)),
      ...['validate-request.mjs', 'intake-origin.mjs', 'cloudflare-email.mjs', 'resend-email.mjs', 'operator-session.mjs', 'request-alerts.mjs'].map(name => fileURLToPath(new URL(`../src/${name}`, import.meta.url)))];
    mf = new bundled.Miniflare(bundled.convertV4MiniflareOptions({ ...mfOptions, scriptPath: undefined,
      modulesRules: undefined, modules: paths.map(path => ({ type: 'ESModule', path })) }));
  } else mf = new Miniflare(mfOptions);
  let disposed = false;
  const dispose = () => { if (!disposed) { disposed = true; return mf.dispose(); } };
  t.after(dispose);
  const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('ARTIFACTS');
  for (const name of ['0001_trials.sql', '0002_billing.sql', '0003_customer_portal.sql', '0004_manual_customer_mail.sql', '0005_customer_email.sql', '0006_intake_protection.sql']) {
    const sql = await readFile(new URL(`../cloudflare/migrations/${name}`, import.meta.url), 'utf8');
    for (const statement of sql.split(';').map(v => v.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const object = await bucket.put('releases/test/server.tar', archive, { customMetadata: { sha256 } });
  assert.equal(object.etag, catalogue.artifacts[0].etag);
  await bucket.put(bindings.TRIAL_CATALOGUE_KEY, catalogueSource);
  const get = (path, token, cookie) => mf.dispatchFetch(origin + path, { headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}),
  } });
  const post = (path, input, token, from = origin) => mf.dispatchFetch(origin + path, { method: 'POST', headers: {
    Origin: from, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(input) });
  const requestInput = { email: 'friend@example.com', plan: 'personal', organization: '', website: '', requestedSeats: 3, consent: true };
  const submit = async (email = requestInput.email) => {
    assert.equal((await post('/api/waitlist', { ...requestInput, email })).status, 202);
    const inbox = await get(admin, operatorToken); assert.equal(inbox.status, 200, await inbox.clone().text());
    return (await inbox.json()).requests.find(row => row.email === email).id;
  };
  const approve = async id => {
    const response = await post(`${admin}/${id}/approve`, { maxUsers: 5 }, operatorToken);
    assert.equal(response.status, 200, await response.clone().text());
    const value = await response.json(); return { ...value, token: value.link.split('.').at(-1), base: `/api/trials/${id}` };
  };
  return { mf, dispose, mfOptions, db, bucket, bindings, operatorToken, intakeKey, publicKeys, catalogue, archive, sha256,
    get, post, submit, approve, requestInput, env: { ...bindings, DB: db, ARTIFACTS: bucket } };
}

test('operator attaches an existing development license without changing identity, expiry or signed bytes',async t=>{
  const f=await fixture(t),id=await f.submit(),installationId=randomUUID();
  const expiresAt=new Date(Date.now()+365*86400000).toISOString();
  const {license}=issueSelfHostedLicense({privateKeyPem:f.bindings.TRIAL_ISSUER_PRIVATE_KEY,keyId:'trial',installationId,
    plan:'development',majorVersion:null,maxActiveUsers:5,sequence:3,expiresAt});
  assert.equal((await f.post(`${admin}/${id}/approve-development`,{license})).status,401);
  assert.equal((await f.post(`${admin}/${id}/approve-development`,{license:'{}'},f.operatorToken)).status,400);
  const response=await f.post(`${admin}/${id}/approve-development`,{license},f.operatorToken);
  assert.equal(response.status,200,await response.clone().text());const a=await response.json();const token=a.link.split('.').at(-1),base=`/api/trials/${id}`;
  assert.equal(a.kind,'development');assert.equal(a.installationId,installationId);assert.equal(a.expiresAt,expiresAt);
  assert.equal(await(await f.get(`${base}/license`,token)).text(),license);
  assert.equal((await f.post(`${base}/activate`,{installationId},token)).status,200);
  assert.equal((await f.post(`${base}/activate`,{installationId:randomUUID()},token)).status,409);
  await f.db.prepare('UPDATE access_requests SET received_at = ? WHERE id = ?').bind(Date.now()-91*86400000,id).run();
  await prune(f.env);assert.equal((await f.get(base,token)).status,200);
  const rotated=await f.post(`${admin}/${id}/rotate`,{},f.operatorToken);assert.equal(rotated.status,200);
  const next=await rotated.json();assert.equal(next.kind,'development');assert.equal(next.expiresAt,expiresAt);
});

test('new development invitations activate the explicitly approved duration, never the trial duration',async t=>{
  const f=await fixture(t),id=await f.submit(),expiresAt=new Date(Date.now()+365*86400000).toISOString();
  const response=await f.post(`${admin}/${id}/approve-development`,{maxUsers:7,expiresAt},f.operatorToken);
  assert.equal(response.status,200);const a=await response.json(),token=a.link.split('.').at(-1),base=`/api/trials/${id}`,installationId=randomUUID();
  assert.equal((await f.post(`${base}/activate`,{installationId},token)).status,200);
  const license=verifyLicenseFile(await(await f.get(`${base}/license`,token)).text(),f.publicKeys,installationId);
  assert.equal(license.plan,'development');assert.equal(license.expiresAt,expiresAt);assert.equal(license.maxActiveUsers,7);
  assert.equal((await(await f.get(base,token)).json()).trialDays,0);
});

test('installer authenticates entitled releases and enforces a server-controlled version floor', async t => {
  const f = await fixture(t, { bindings: { INSTALLER_MIN_VERSION: '0.2.0' } });
  const a = await f.approve(await f.submit());
  const request = (action, version, token = a.token) => f.mf.dispatchFetch(`${origin}${a.base}/${action}`, {
    headers: { Authorization: `Bearer ${token}`, ...(version ? { 'X-127Vaults-Installer-Version': version } : {}) },
  });
  assert.equal((await request('installer', '0.2.0', 'x'.repeat(43))).status, 401);
  assert.equal((await request('installer')).status, 426);
  assert.equal((await request('installer', '0.1.0')).status, 426);
  assert.equal((await request('artifacts/server', '0.1.0')).status, 426);
  const response = await request('installer', '0.2.0');
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.equal(plan.protocolVersion, 1);
  assert.equal(plan.minimumInstallerVersion, '0.2.0');
  assert.equal(plan.installationId, null);
  assert.equal(plan.artifacts[0].sha256, f.sha256);
  assert.equal(plan.artifacts[0].objectKey, undefined);
  const id = randomUUID();
  const blockedActivation = await f.mf.dispatchFetch(`${origin}${a.base}/activate`, { method: 'POST', headers: {
    Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}`, 'X-127Vaults-Installer-Version': '0.1.0',
  }, body: JSON.stringify({ installationId: id }) });
  assert.equal(blockedActivation.status, 426);
  assert.equal((await (await request('installer', '0.2.0')).json()).installationId, null);
  assert.equal((await f.post(`${a.base}/activate`, { installationId: id }, a.token)).status, 200);
  assert.equal((await (await request('installer', '0.2.0')).json()).installationId, id);
  // Legacy browser downloads retain their normal authenticated flow.
  assert.equal((await f.get(`${a.base}/artifacts/server`, a.token)).status, 200);
});

test('Cloudflare runtime: request, approval, R2 cookie download, compatible license, rotation and closure', async t => {
  const f = await fixture(t);
  assert.equal(await (await f.get('/')).text(), 'static website');
  assert.equal((await f.get(admin)).status, 401);
  assert.equal((await f.get('/api/access-admin/readiness')).status, 401);
  const readiness = await f.get('/api/access-admin/readiness', f.operatorToken);
  assert.equal(readiness.status, 200, await readiness.clone().text());
  assert.equal((await readiness.json()).ready, true);
  assert.equal((await f.post('/api/waitlist', f.requestInput, null, 'https://evil.example')).status, 403);
  const id = await f.submit(), a = await f.approve(id);
  assert.equal((await f.post(`${admin}/${id}/approve`, { maxUsers: 5 }, f.operatorToken)).status, 409);
  assert.equal((await f.get(a.base)).status, 401);
  const view = await (await f.get(a.base, a.token)).json();
  assert.equal(view.artifacts[0].objectKey, undefined); assert.equal(view.artifacts[0].etag, undefined);
  assert.equal(view.artifacts[0].sha256, f.sha256);
  assert.equal(await (await f.get(`${a.base}/artifacts/server`, a.token)).text(), f.archive);
  const ticket = await f.post(`${a.base}/ticket`, {}, a.token);
  assert.match(ticket.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/);
  const cookie = ticket.headers.get('set-cookie').split(';')[0];
  assert.equal(await (await f.get(`${a.base}/artifacts/server`, null, cookie)).text(), f.archive);
  const installationId = randomUUID();
  const activation = await f.post(`${a.base}/activate`, { installationId }, a.token);
  assert.equal(activation.status, 200, await activation.clone().text());
  const dates = await activation.json(); assert.equal(Date.parse(dates.expiresAt) - Date.parse(dates.activatedAt), 10 * 86400000);
  const license = await (await f.get(`${a.base}/license`, a.token)).text();
  const payload = verifyLicenseFile(license, f.publicKeys, installationId); assert.equal(payload.maxActiveUsers, 5);
  assert.equal((await f.post(`${a.base}/activate`, { installationId: randomUUID() }, a.token)).status, 409);
  assert.equal((await f.post(`${a.base}/activate`, { installationId }, a.token)).status, 200);
  assert.equal(await (await f.get(`${a.base}/license`, a.token)).text(), license);
  const archived = await f.post(`${admin}/${id}/archive`, {}, f.operatorToken); assert.equal(archived.status, 200);
  assert.equal((await (await f.get(admin, f.operatorToken)).json()).requests[0].state, 'approved');
  const rotate = await (await f.post(`${admin}/${id}/rotate`, {}, f.operatorToken)).json();
  const nextToken = rotate.link.split('.').at(-1);
  assert.equal((await f.get(a.base, a.token)).status, 401);
  assert.equal((await f.get(`${a.base}/artifacts/server`, null, cookie)).status, 401);
  assert.equal(await (await f.get(`${a.base}/license`, nextToken)).text(), license);
  await f.bucket.put(f.catalogue.artifacts[0].objectKey, 'changed bytes', { customMetadata: { sha256: f.sha256 } });
  assert.equal((await f.get(`${a.base}/artifacts/server`, nextToken)).status, 503);
  assert.equal((await f.post(`${admin}/${id}/close`, {}, f.operatorToken)).status, 200);
  assert.equal((await f.get(a.base, nextToken)).status, 404);
  const revocation = await (await f.get(`${admin}/${id}/revocation`, f.operatorToken)).text();
  verifyLicenseRevocationFile(revocation, f.publicKeys, installationId, payload.licenseId);
  const saved = await f.db.prepare('SELECT * FROM access_requests WHERE id = ?').bind(id).first();
  assert.ok(!saved.contact.includes('friend@example.com')); assert.ok(!saved.trial.includes(installationId));
  assert.ok(!saved.trial.includes(nextToken));
  assert.equal((await f.post(`${admin}/${id}/erase`, {}, f.operatorToken)).status, 200);
  assert.equal((await f.db.prepare('SELECT contact FROM access_requests WHERE id = ?').bind(id).first()).contact, null);
  assert.equal((await (await f.get(admin, f.operatorToken)).json()).requests.length, 0);
});

test('D1 concurrency: one approval, one installation binding, stale writes refused, limiter atomic', async t => {
  const f = await fixture(t), id = await f.submit();
  const approvals = await Promise.all(Array.from({ length: 5 }, () => f.post(`${admin}/${id}/approve`, { maxUsers: 3 }, f.operatorToken)));
  assert.equal(approvals.filter(r => r.status === 200).length, 1);
  assert.ok(approvals.every(r => [200, 409].includes(r.status)));
  const a = await approvals.find(r => r.status === 200).json(), token = a.link.split('.').at(-1), base = `/api/trials/${id}`;
  const installations = [randomUUID(), randomUUID()];
  const activations = await Promise.all(installations.map(installationId => f.post(`${base}/activate`, { installationId }, token)));
  assert.equal(activations.filter(r => r.status === 200).length, 1);
  assert.equal(activations.filter(r => r.status === 409).length, 1);
  const contactKey = await encryptionKey(f.intakeKey, 'contacts'), trialKey = await encryptionKey(f.intakeKey, 'trials');
  const store = new TrialStore(f.db, contactKey, trialKey, () => Date.now(), await limiterKey(f.intakeKey));
  const stale = await store.get(id), fresh = await store.get(id);
  await store.save(fresh, { ...fresh.trial, state: 'closed' });
  await assert.rejects(store.save(stale, { ...stale.trial, state: 'approved' }), /state_changed/);
  const limits = await Promise.all(Array.from({ length: 12 }, () => store.allow('atomic-test', 'same-ip', 3, 3600000)));
  assert.equal(limits.filter(Boolean).length, 3);
});

test('retention closes old links and erases contact while retaining compatible signed revocation', async t => {
  const f = await fixture(t), id = await f.submit(), a = await f.approve(id), installationId = randomUUID();
  await f.post(`${a.base}/activate`, { installationId }, a.token);
  const license = verifyLicenseFile(await (await f.get(`${a.base}/license`, a.token)).text(), f.publicKeys, installationId);
  await f.db.prepare('UPDATE access_requests SET received_at = ? WHERE id = ?').bind(Date.now() - 91 * 86400000, id).run();
  await prune(f.env);
  const row = await f.db.prepare('SELECT * FROM access_requests WHERE id = ?').bind(id).first();
  assert.equal(row.contact, null);
  const record = await unseal(row.trial, await encryptionKey(f.intakeKey, 'trials'), `trial:${id}`);
  assert.equal(record.state, 'closed'); assert.equal(record.invitation, undefined);
  verifyLicenseRevocationFile(record.revocation, f.publicKeys, installationId, license.licenseId);
});

test('encrypted records bind ciphertext to both record ID and purpose', async () => {
  const key = await encryptionKey(randomBytes(32).toString('hex'), 'contacts');
  const envelope = await seal({ email: 'private@example.com' }, key, 'contact:a');
  await assert.rejects(unseal(envelope, key, 'contact:b'));
  assert.equal((await unseal(envelope, key, 'contact:a')).email, 'private@example.com');
});

test('Worker email claims survive concurrent sends, ambiguous replies and closure during provider I/O', { timeout: 15000 }, async t => {
  let announce, finish;
  let reached = new Promise(resolve => { announce = resolve; });
  let gate = new Promise(resolve => { finish = resolve; });
  let sent = 0, ambiguous = false, recipient = 'friend@example.com';
  const f = await fixture(t, { bindings: { CF_ACCOUNT_ID: 'a'.repeat(32),
    TRIAL_EMAIL_FROM: 'trials@example.com', TRIAL_EMAIL_API_TOKEN: 'x'.repeat(32) },
    outboundService: async request => {
      sent++; announce();
      assert.equal(request.url, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/email/sending/send`);
      const message = await request.json(); assert.equal(message.to, recipient);
      assert.equal(message.from, 'trials@example.com'); assert.match(message.text, /trial\?open=1#/);
      await gate;
      return Response.json(ambiguous ? { success: false } : { success: true, result: { queued: [recipient] } });
    } });
  const id = await f.submit(), a = await f.approve(id);
  const pending = f.post(`${admin}/${id}/send-invitation`, {}, f.operatorToken);
  await Promise.race([reached, pending.then(async response => { throw Error(`Email finished before provider: ${response.status} ${await response.text()}`); })]);
  assert.equal((await f.post(`${admin}/${id}/send-invitation`, {}, f.operatorToken)).status, 409);
  assert.equal((await f.post(`${admin}/${id}/close`, {}, f.operatorToken)).status, 200);
  finish(); assert.equal((await pending).status, 200); assert.equal(sent, 1);
  const row = (await (await f.get(admin, f.operatorToken)).json()).requests[0];
  assert.equal(row.state, 'closed'); assert.equal(row.canPreviewInvitation, false);
  assert.equal((await f.get(a.base, a.token)).status, 404);

  const next = await f.submit('second@example.com'); await f.approve(next);
  // A provider error is still recorded before returning, and never authorizes automatic retries.
  reached = new Promise(resolve => { announce = resolve; });
  gate = Promise.resolve(); ambiguous = true; recipient = 'second@example.com';
  const response = await f.post(`${admin}/${next}/send-invitation`, {}, f.operatorToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).emailState, 'unknown');
  assert.equal((await f.post(`${admin}/${next}/send-invitation`, {}, f.operatorToken)).status, 409);
  recipient = 'third@example.com'; ambiguous = false;
  const third = await f.submit(recipient); await f.approve(third);
  const queued = await f.post(`${admin}/${third}/send-invitation`, {}, f.operatorToken);
  assert.equal((await queued.json()).emailState, 'queued');
});

test('Worker validation refuses oversized and malformed input, honeypots, wrong methods and stale releases', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/api/waitlist', { ...f.requestInput, email: 'invalid' })).status, 400);
  assert.equal((await f.post('/api/waitlist', { ...f.requestInput, organization: 'x'.repeat(3000) })).status, 413);
  assert.equal((await f.post('/api/waitlist', { ...f.requestInput, website: 'bot' })).status, 202);
  assert.equal((await (await f.get(admin, f.operatorToken)).json()).requests.length, 0);
  assert.equal((await f.mf.dispatchFetch(origin + '/api/waitlist', { method: 'DELETE' })).status, 405);
  const id = await f.submit(), a = await f.approve(id);
  const store = new TrialStore(f.db, await encryptionKey(f.intakeKey, 'contacts'), await encryptionKey(f.intakeKey, 'trials'));
  const row = await store.get(id); await store.save(row, { ...row.trial, releaseHash: 'b'.repeat(64) });
  assert.equal((await f.get(a.base, a.token)).status, 200);
  assert.equal((await f.post(`${admin}/${id}/rotate`, {}, f.operatorToken)).status, 200);
  await f.bucket.put(f.bindings.TRIAL_CATALOGUE_KEY, JSON.stringify({ ...f.catalogue, sourceRevision: 'b'.repeat(40) }));
  assert.equal((await f.get(a.base, a.token)).status, 503);
  assert.equal((await f.get('/api/access-admin/readiness', f.operatorToken)).status, 503);
  // Unactivated contact erasure/closure must not depend on an available release bucket.
  assert.equal((await f.post(`${admin}/${id}/close`, {}, f.operatorToken)).status, 200);
  assert.equal((await f.post(`${admin}/${id}/erase`, {}, f.operatorToken)).status, 200);
});

test('operator can offer client-only updates without renewing or rebinding an activated trial', async t => {
  const f=await fixture(t),id=await f.submit(),a=await f.approve(id),installationId=randomUUID();
  assert.equal((await f.post(`${a.base}/activate`,{installationId},a.token)).status,200);
  const license=await (await f.get(`${a.base}/license`,a.token)).text();
  const store=new TrialStore(f.db,await encryptionKey(f.intakeKey,'contacts'),await encryptionKey(f.intakeKey,'trials'));
  const row=await store.get(id),expiresAt=row.trial.expiresAt;
  await store.save(row,{...row.trial,releaseHash:'b'.repeat(64)});
  const inbox = await (await f.get(admin, f.operatorToken)).json();
  assert.equal(inbox.requests[0].sourceRevision, inbox.sourceRevision);
  assert.equal(inbox.requests[0].updateAvailable, true);
  assert.equal((await f.post(`${admin}/${id}/update-release`,{})).status,401);
  const update=await f.post(`${admin}/${id}/update-release`,{},f.operatorToken);
  assert.equal(update.status,200,await update.clone().text());
  const data=await update.json(),replacement=data.link.split('.').at(-1);
  assert.equal(data.expiresAt,expiresAt);assert.equal(data.installationId,installationId);
  assert.equal(data.sourceRevision,'a'.repeat(40));
  assert.equal((await f.get(a.base,a.token)).status,401);
  assert.equal(await (await f.get(`${a.base}/license`,replacement)).text(),license);
  assert.equal((await (await f.get(admin,f.operatorToken)).json()).requests[0].updateAvailable,false);
});

test('removing email sender disables sending despite a retained Worker secret', async t => {
  const f = await fixture(t, { bindings: { TRIAL_EMAIL_API_TOKEN: 'x'.repeat(32) } });
  const id = await f.submit(); await f.approve(id);
  const inbox = await (await f.get(admin, f.operatorToken)).json();
  assert.equal(inbox.emailEnabled, false);
  assert.equal((await f.post(`${admin}/${id}/send-invitation`, {}, f.operatorToken)).status, 503);
});

test('private installer downloads support authorized resume and HEAD without bypassing closure', async t => {
  const f = await fixture(t), id = await f.submit(), a = await f.approve(id);
  const download = (method, range, token = a.token) => f.mf.dispatchFetch(origin + a.base + '/artifacts/server', {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(range ? { Range: range } : {}) },
  });
  assert.equal((await download('HEAD', null, '')).status, 401);
  const info = await download('HEAD'); assert.equal(info.status, 200); assert.equal(await info.text(), '');
  assert.equal(info.headers.get('content-length'), String(f.archive.length));
  const part = await download('GET', 'bytes=3-10'); assert.equal(part.status, 206);
  assert.equal(await part.text(), f.archive.slice(3, 11));
  assert.equal(part.headers.get('content-range'), `bytes 3-10/${f.archive.length}`);
  const suffix = await download('GET', 'bytes=-5'); assert.equal(await suffix.text(), f.archive.slice(-5));
  const rest = await download('GET', 'bytes=5-'); assert.equal(await rest.text(), f.archive.slice(5));
  for (const range of ['bytes=999-', 'bytes=8-3', 'bytes=0-1,3-4', 'bytes=-0', 'items=0-1']) {
    const bad = await download('GET', range); assert.equal(bad.status, 416);
    assert.equal(bad.headers.get('content-range'), `bytes */${f.archive.length}`);
  }
  await f.post(`${admin}/${id}/close`, {}, f.operatorToken);
  assert.equal((await download('GET', 'bytes=3-10')).status, 404);
  assert.equal((await download('HEAD')).status, 404);
});

test('actual static asset routing serves public HTML and modules while API and excluded files remain protected', async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-worker-assets-'));
  const assets = join(directory, 'site'); await stageAssets(assets);
  const f = await fixture(t, { assetsDirectory: assets });
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const path of ['/', '/get-started', '/access-admin', '/trial', '/trial.mjs', '/site.css']) {
    const response = await f.get(path); assert.equal(response.status, 200, path);
  }
  for (const [from, to] of [['/index.html', '/'], ['/pricing.html', '/pricing'], ['/pricing/', '/pricing'], ['/trial.html', '/trial']]) {
    const response = await f.mf.dispatchFetch(origin + from, { redirect: 'manual' }); assert.equal(response.status, 307, from);
    assert.equal(new URL(response.headers.get('location'), origin).pathname, to);
  }
  for (const path of ['/build-pages.mjs', '/availability.test.mjs', '/README.md', '/mock-checkout.html', '/customer-account.html', '/issuer.pem']) {
    assert.equal((await f.get(path)).status, 404, path);
  }
  assert.equal((await f.get(admin)).status, 401);
  const id = await f.submit(); assert.ok(id); // API routing still invokes the authenticated Worker.
});

test('durable D1/R2 state survives a fresh Worker runtime without issuing another license', async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-worker-restart-'));
  const f = await fixture(t, { persistDirectory: directory }), id = await f.submit(), a = await f.approve(id);
  const installationId = randomUUID(); await f.post(`${a.base}/activate`, { installationId }, a.token);
  const license = await (await f.get(`${a.base}/license`, a.token)).text();
  await f.dispose();
  const restarted = new Miniflare(f.mfOptions); t.after(() => restarted.dispose());
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { headers: { Authorization: `Bearer ${a.token}` } };
  assert.equal(await (await restarted.dispatchFetch(origin + a.base + '/license', options)).text(), license);
  assert.equal(await (await restarted.dispatchFetch(origin + a.base + '/artifacts/server', options)).text(), f.archive);
  const again = await restarted.dispatchFetch(origin + a.base + '/activate', { method: 'POST', headers: {
    Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}`,
  }, body: JSON.stringify({ installationId }) });
  assert.equal(again.status, 200);
  assert.equal(await (await restarted.dispatchFetch(origin + a.base + '/license', options)).text(), license);
});

test('expired download tickets and invitation links cannot authorize a new request', async t => {
  const f = await fixture(t), id = await f.submit(), a = await f.approve(id);
  const response = await f.post(`${a.base}/ticket`, {}, a.token), cookie = response.headers.get('set-cookie').split(';')[0];
  const download = new Request(origin + a.base + '/artifacts/server', { headers: { Cookie: cookie } });
  assert.equal((await handleRequest(download, f.env, { now: () => Date.now() + 6 * 60000 })).status, 401);
  const expired = new Request(origin + a.base, { headers: { Authorization: `Bearer ${a.token}` } });
  assert.equal((await handleRequest(expired, f.env, { now: () => Date.now() + 31 * 86400000 })).status, 404);
});

test('the runtime bundled with the deployment CLI accepts the same D1/R2 and license flow', async t => {
  const f = await fixture(t, { cliRuntime: true }), id = await f.submit(), a = await f.approve(id);
  const installationId = randomUUID();
  assert.equal((await f.post(`${a.base}/activate`, { installationId }, a.token)).status, 200);
  const license = await (await f.get(`${a.base}/license`, a.token)).text();
  assert.equal(verifyLicenseFile(license, f.publicKeys, installationId).maxActiveUsers, 5);
  assert.equal(await (await f.get(`${a.base}/artifacts/server`, a.token)).text(), f.archive);
});

test('operator key exchange survives refresh via scoped cookie and refuses cross-origin renewal', async t => {
  const f = await fixture(t);
  const response = await f.post('/api/access-admin/session', {}, f.operatorToken);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await f.get(admin, undefined, cookie)).status, 200);
  assert.equal((await f.get(admin, undefined, cookie + 'broken')).status, 401);
  assert.equal((await f.post('/api/access-admin/session', {}, f.operatorToken, 'https://other.example')).status, 403);
  const renew = await f.mf.dispatchFetch(origin + '/api/access-admin/session', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' });
  assert.equal(renew.status, 401);
  const logout = await f.mf.dispatchFetch(origin + '/api/access-admin/logout', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('fixed-recipient request alerts are durable, contain only a review summary, and fail without losing the request', async t => {
  const f = await fixture(t); let sent = [], fail = false;
  const env = { ...f.env, REQUEST_ALERT_TO: 'ops@example.com', REQUEST_ALERT_FROM: 'requests@trial.example.com',
    REQUEST_ALERTS: { send: async message => { sent.push(message); if (fail) throw Error('private-provider-error'); return { messageId: 'synthetic-accepted' }; } } };
  const submit = input => handleRequest(new Request(origin + '/api/waitlist', { method: 'POST', headers: {
    Origin: origin, 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.10' }, body: JSON.stringify(input) }), env);
  const response = await submit(f.requestInput); assert.equal(response.status, 202);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'ops@example.com');
  assert.ok(sent[0].text.includes(f.requestInput.email)); assert.ok(sent[0].text.includes(origin + '/access-admin'));
  const requestId = (await (await f.get(admin, f.operatorToken)).json()).requests[0].id;
  assert.ok(sent[0].text.includes(`/access-admin?request=${requestId}`));
  assert.match(sent[0].text, /Opening this link does not approve/);
  assert.ok(!sent[0].text.includes(f.operatorToken)); assert.doesNotMatch(sent[0].text, /\/trial(?:\.html)?(?:\?|#)/);
  let inbox = (await (await f.get(admin, f.operatorToken)).json()).requests;
  assert.equal(inbox[0].requestAlertState, 'accepted');
  await submit({ ...f.requestInput, website: 'bot trap' }); assert.equal(sent.length, 1);
  fail = true;
  assert.equal((await submit({ ...f.requestInput, email: 'another@example.com' })).status, 202);
  inbox = (await (await f.get(admin, f.operatorToken)).json()).requests;
  assert.equal(inbox.find(row => row.email === 'another@example.com').requestAlertState, 'unconfirmed');
  assert.equal(inbox.length, 2);
});

test('a request alert cannot overwrite a concurrent approval or resend an ambiguous attempt', async t => {
  const f=await fixture(t);let announce,finish,sends=0;
  const reached=new Promise(resolve=>{announce=resolve}),gate=new Promise(resolve=>{finish=resolve});
  const env={...f.env,REQUEST_ALERT_TO:'ops@example.com',REQUEST_ALERT_FROM:'requests@trial.example.com',REQUEST_ALERTS:{send:async()=>{sends++;announce();await gate;return{messageId:'synthetic'}}}};
  const pending=handleRequest(new Request(origin+'/api/waitlist',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(f.requestInput)}),env);
  await reached;
  const row=(await(await f.get(admin,f.operatorToken)).json()).requests[0];
  await f.approve(row.id);finish();assert.equal((await pending).status,202);
  const after=(await(await f.get(admin,f.operatorToken)).json()).requests[0];
  assert.equal(after.state,'approved');assert.equal(after.requestAlertState,'accepted');
  const store=new TrialStore(f.db,await encryptionKey(f.intakeKey,'contacts'),await encryptionKey(f.intakeKey,'trials'));
  const {notifyNewAccessRequest}=await import('../src/request-alerts.mjs');
  await notifyNewAccessRequest(env,store,row.id,f.requestInput,Date.now());
  assert.equal(sends,1);
});


test('existing links follow latest entitled major, retain license, and never cross majors', async t => {
  const f = await fixture(t), id = await f.submit(), a = await f.approve(id), installationId = randomUUID();
  await f.post(`${a.base}/activate`, { installationId }, a.token);
  const license = await (await f.get(`${a.base}/license`, a.token)).text();
  const swap = async catalogue => {
    const source = JSON.stringify(catalogue);
    await f.bucket.put(f.bindings.TRIAL_CATALOGUE_KEY, source);
    f.env.TRIAL_CATALOGUE_SHA256 = createHash('sha256').update(source).digest('hex');
  };
  const get = path => handleRequest(new Request(origin + path, { headers: { Authorization: `Bearer ${a.token}` } }), f.env);
  const patch = { ...f.catalogue, sourceRevision: 'c'.repeat(40), serverMajorVersion: 0 };
  await swap(patch);
  assert.equal((await (await get(a.base)).json()).sourceRevision, patch.sourceRevision);
  assert.equal(await (await get(`${a.base}/license`)).text(), license);
  assert.equal(await (await get(`${a.base}/artifacts/server`)).text(), f.archive);
  assert.equal((await get(a.base.replace(id, 'f'.repeat(64)))).status, 404);
  const oldSource = JSON.stringify(patch), oldKey = 'releases/major-0/catalogue.json';
  await f.bucket.put(oldKey, oldSource);
  await swap({ ...f.catalogue, serverMajorVersion: 1, sourceRevision: 'd'.repeat(40), previousMajors: [
    { majorVersion: 0, objectKey: oldKey, sha256: createHash('sha256').update(oldSource).digest('hex') }
  ] });
  assert.equal((await (await get(a.base)).json()).sourceRevision, patch.sourceRevision);
  assert.equal(await (await get(`${a.base}/license`)).text(), license);
  await swap({ ...f.catalogue, serverMajorVersion: 2 });
  const blocked = await get(a.base);
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error, 'licensed_major_unavailable');
  // A major-1 entitlement follows major-1 while major-2 is the default catalogue.
  const store = new TrialStore(f.db, await encryptionKey(f.intakeKey, 'contacts'), await encryptionKey(f.intakeKey, 'trials'));
  const row = await store.get(id); await store.save(row, { ...row.trial, serverMajorVersion: 1 });
  const v1 = { ...f.catalogue, serverMajorVersion: 1, sourceRevision: 'e'.repeat(40) }, source = JSON.stringify(v1);
  await f.bucket.put('releases/major-1/catalogue.json', source);
  await swap({ ...f.catalogue, serverMajorVersion: 2, previousMajors: [{ majorVersion: 1,
    objectKey: 'releases/major-1/catalogue.json', sha256: createHash('sha256').update(source).digest('hex') }] });
  assert.equal((await (await get(a.base)).json()).sourceRevision, v1.sourceRevision);
  await f.bucket.put('releases/major-1/catalogue.json', JSON.stringify({ ...v1, serverMajorVersion: 2 }));
  assert.equal((await get(a.base)).status, 503);
});


test('new major-1 approvals pin major 1 and rotation cannot upgrade entitlement', async t => {
  const f = await fixture(t), id = await f.submit();
  const swap = async catalogue => {
    const source = JSON.stringify(catalogue); await f.bucket.put(f.bindings.TRIAL_CATALOGUE_KEY, source);
    f.env.TRIAL_CATALOGUE_SHA256 = createHash('sha256').update(source).digest('hex');
  };
  const post = (path, input) => handleRequest(new Request(origin + path, { method: 'POST', headers: {
    Authorization: `Bearer ${f.operatorToken}`, Origin: origin, 'Content-Type': 'application/json'
  }, body: JSON.stringify(input) }), f.env);
  const v1 = { ...f.catalogue, serverMajorVersion: 1 };
  await swap(v1);
  const approval = await post(`${admin}/${id}/approve`, { maxUsers: 2 });
  assert.equal(approval.status, 200);
  const a = await approval.json(); assert.equal(a.serverMajorVersion, 1);
  const source = JSON.stringify(v1), objectKey = 'releases/v1/catalogue.json'; await f.bucket.put(objectKey, source);
  await swap({ ...f.catalogue, serverMajorVersion: 2, previousMajors: [{ majorVersion: 1, objectKey,
    sha256: createHash('sha256').update(source).digest('hex') }] });
  const rotated = await post(`${admin}/${id}/rotate`, {});
  assert.equal(rotated.status, 200); assert.equal((await rotated.json()).serverMajorVersion, 1);
  await swap({ ...f.catalogue, serverMajorVersion: 2 });
  assert.equal((await post(`${admin}/${id}/update-release`, {})).status, 409);
});


test('operator session opens release review and downloads without creating or activating a trial', async t => {
  const retiredKey = randomBytes(32).toString('base64url');
  const f = await fixture(t, { bindings: { REVIEWER_TOKEN: retiredKey, REVIEWER_ACCESS_ENABLED: 'true' } });
  assert.equal((await f.get('/api/access-admin/releases')).status, 401);
  assert.equal((await f.get('/api/access-admin/releases', retiredKey)).status, 401);
  assert.equal((await f.post('/api/access-admin/session', {}, retiredKey)).status, 401);
  const login = await f.post('/api/access-admin/session', {}, f.operatorToken);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const metadata = await (await f.get('/api/access-admin/releases', null, cookie)).json();
  assert.equal(metadata.canDownload, true); assert.equal(metadata.artifacts[0].objectKey, undefined);
  assert.equal(await (await f.get('/api/access-admin/releases/artifacts/server', null, cookie)).text(), f.archive);
  assert.equal((await f.get('/api/access-admin/releases/artifacts/server')).status, 401);
  const expired = await handleRequest(new Request(origin + '/api/access-admin/releases', { headers: { Cookie: cookie } }), f.env,
    { now: () => Date.now() + 3601000 });
  assert.equal(expired.status, 401);
  assert.equal((await (await f.get(admin, f.operatorToken)).json()).requests.length, 0);
});


test('self-service replacement request revokes old license; owner issues a new binding without renewal', async t => {
  const reviewer = randomBytes(32).toString('base64url');
  const f = await fixture(t, { bindings: { REVIEWER_TOKEN: reviewer, REVIEWER_ACCESS_ENABLED: 'true' } }), id = await f.submit(), a = await f.approve(id);
  const oldId = randomUUID(), newId = randomUUID();
  const request = { installationId: newId, reason: 'Lost server identity in a test machine failure', retired: true };
  assert.equal((await f.post(`${a.base}/replacement-request`, request, a.token)).status, 409);
  await f.post(`${a.base}/activate`, { installationId: oldId }, a.token);
  const original = verifyLicenseFile(await (await f.get(`${a.base}/license`, a.token)).text(), f.publicKeys, oldId);
  assert.equal((await f.post(`${a.base}/replacement-request`, { ...request, retired: false }, a.token)).status, 400);
  assert.equal((await f.post(`${a.base}/replacement-request`, { ...request, installationId: oldId }, a.token)).status, 409);
  assert.equal((await f.post(`${a.base}/replacement-request`, request)).status, 401);
  let alerts = 0;
  f.env.REQUEST_ALERT_TO = 'operator@example.com'; f.env.REQUEST_ALERT_FROM = 'requests@trial.example.com';
  f.env.REQUEST_ALERTS = { send: async message => { alerts++; assert.equal(message.to, 'operator@example.com');
    assert.match(message.subject, /replacement license requested/); assert.ok(!message.text.includes(a.token)); return { messageId: 'replacement-test' }; } };
  const requested = await handleRequest(new Request(origin + a.base + '/replacement-request', { method: 'POST',
    headers: { Authorization: `Bearer ${a.token}`, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(request) }), f.env);
  assert.equal(alerts, 1);
  assert.equal(requested.status, 202);
  assert.equal((await requested.json()).replacementRequest.installationId, newId);
  assert.equal((await f.post(`${a.base}/replacement-request`, request, a.token)).status, 409);
  assert.equal((await f.get(`${a.base}/license`, a.token)).status, 409);
  assert.equal((await f.post(`${a.base}/activate`, { installationId: oldId }, a.token)).status, 409);
  const revocation = await (await f.get(`${a.base}/replacement-revocation`, a.token)).text();
  verifyLicenseRevocationFile(revocation, f.publicKeys, oldId, original.licenseId);
  assert.equal((await f.post(`${admin}/${id}/replace-installation`, { installationId: newId, retired: true }, reviewer)).status, 401);
  assert.equal((await f.post(`${admin}/${id}/replace-installation`, { installationId: randomUUID(), retired: true }, f.operatorToken)).status, 400);
  const expiredApproval = await handleRequest(new Request(origin + admin + '/' + id + '/replace-installation', { method: 'POST',
    headers: { Authorization: `Bearer ${f.operatorToken}`, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId: newId, retired: true }) }), f.env, { now: () => Date.parse(original.expiresAt) + 1000 });
  assert.equal(expiredApproval.status, 409); assert.equal((await expiredApproval.json()).error, 'license_expired');
  const issued = await f.post(`${admin}/${id}/replace-installation`, { installationId: newId, retired: true }, f.operatorToken);
  assert.equal(issued.status, 200, await issued.clone().text());
  const state = await issued.json(); assert.equal(state.installationId, newId); assert.equal(state.replacementCount, 1);
  assert.equal(state.replacementRequest, null); assert.equal(state.expiresAt, original.expiresAt);
  const next = verifyLicenseFile(await (await f.get(`${a.base}/license`, a.token)).text(), f.publicKeys, newId);
  assert.equal(next.expiresAt, original.expiresAt); assert.equal(next.maxActiveUsers, original.maxActiveUsers);
  assert.equal(next.plan, original.plan); assert.equal(next.majorVersion, original.majorVersion);
  assert.equal(next.sequence, original.sequence + 1); assert.notEqual(next.licenseId, original.licenseId);
  assert.equal((await f.post(`${a.base}/activate`, { installationId: oldId }, a.token)).status, 409);
  assert.equal(await (await f.get(`${a.base}/replacement-revocation`, a.token)).text(), revocation);
  assert.equal(await (await f.get(`${admin}/${id}/revocation`, f.operatorToken)).text(), revocation);
  const invitation = await (await f.get(`${admin}/${id}/invitation`, f.operatorToken)).json();
  assert.match(invitation.message, /replacement license/i); assert.ok(invitation.message.includes(a.token));
  const future = Date.parse(original.expiresAt) + 1000;
  const expiredRequest = await handleRequest(new Request(origin + a.base + '/replacement-request', { method: 'POST',
    headers: { Authorization: `Bearer ${a.token}`, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, installationId: randomUUID() }) }), f.env, { now: () => future });
  assert.equal(expiredRequest.status, 409); assert.equal((await expiredRequest.json()).error, 'license_expired');
});


test('operator extends active and expired trials with signed monotonic licenses and stale-write protection', async t => {
  const f = await fixture(t), id = await f.submit(), a = await f.approve(id), installationId = randomUUID();
  assert.equal((await f.post(admin + '/' + id + '/extend', {days: 10, expectedExpiresAt: null}, f.operatorToken)).status, 409);
  await f.post(a.base + '/activate', {installationId}, a.token);
  const old = verifyLicenseFile(await (await f.get(a.base + '/license', a.token)).text(), f.publicKeys, installationId);
  const input = { days: 20, expectedExpiresAt: old.expiresAt };
  assert.equal((await f.post(admin + '/' + id + '/extend', input, a.token)).status, 401);
  for (const days of [0, -1, 61, 1.5, '10']) assert.equal((await f.post(admin + '/' + id + '/extend', {...input, days}, f.operatorToken)).status, 400);
  const response = await f.post(admin + '/' + id + '/extend', input, f.operatorToken);
  assert.equal(response.status, 200, await response.clone().text());
  const extended = await response.json(), nextToken = extended.link.split('.').at(-1);
  assert.match(extended.message, /install it on your existing server/);
  assert.equal(Date.parse(extended.expiresAt) - Date.parse(old.expiresAt), 20 * 86400000);
  const next = verifyLicenseFile(await (await f.get(a.base + '/license', nextToken)).text(), f.publicKeys, installationId);
  assert.equal(next.sequence, old.sequence + 1); assert.equal(next.maxActiveUsers, old.maxActiveUsers);
  assert.equal(next.majorVersion, old.majorVersion); assert.equal(next.plan, old.plan);
  assert.equal((await f.get(a.base, a.token)).status, 401);
  assert.equal((await f.post(admin + '/' + id + '/extend', input, f.operatorToken)).status, 409);
  const at = Date.parse(next.expiresAt) + 86400000;
  const expired = await handleRequest(new Request(origin + admin + '/' + id + '/extend', {method:'POST', headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer ' + f.operatorToken}, body:JSON.stringify({days:5,expectedExpiresAt:next.expiresAt})}), f.env, {now:()=>at});
  assert.equal(expired.status, 200, await expired.clone().text());
  const renewed = await expired.json(); assert.equal(Date.parse(renewed.expiresAt), at + 5 * 86400000);
  await f.db.prepare('UPDATE access_requests SET received_at = ? WHERE id = ?').bind(at - 100 * 86400000, id).run();
  await prune(f.env, {now:()=>at});
  const inbox = await handleRequest(new Request(origin + admin, {headers:{Authorization:'Bearer ' + f.operatorToken}}), f.env, {now:()=>at});
  assert.equal((await inbox.json()).requests.length, 1);
  await prune(f.env, {now:()=>Date.parse(renewed.expiresAt) + 1});
  assert.equal((await f.db.prepare('SELECT contact FROM access_requests WHERE id = ?').bind(id).first()).contact, null);
});

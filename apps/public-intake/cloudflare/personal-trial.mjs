import { compatiblePersonalMajor } from '../../server/src/license-version.mjs';
import { serverMajor } from './catalogue.mjs';
import { hash, limitIdentity, token } from './crypto.mjs';
import { DodoError, dodo, reject } from './dodo.mjs';

export const personalTrialDays = 15;
const sessionId = /^cks_[A-Za-z0-9]{1,100}$/;
const paymentId = /^pay_[A-Za-z0-9]{1,100}$/;
const oneProduct = (cart, id) => Array.isArray(cart) && cart.length === 1
  && cart[0]?.product_id === id && cart[0]?.quantity === 1;

export async function personalTrialId(store, mode, email) {
  return hash(await limitIdentity(store.limiterKey, `personal-trial:${mode}:${email}`));
}

export async function confirmPersonalTrial(env, store, row, now, fetcher, payment) {
  const record = row.trial;
  const order = record.trialCheckout;
  if (record.state !== 'trial_pending' || order.mode !== env.DODO_MODE || !sessionId.test(order.sessionId ?? '')) return;
  if (!payment) {
    const session = await dodo(env, `/checkouts/${order.sessionId}`, 'GET', undefined, fetcher);
    if (session.id !== order.sessionId || !paymentId.test(session.payment_id ?? '')) return;
    payment = await dodo(env, `/payments/${session.payment_id}`, 'GET', undefined, fetcher);
    if (payment.payment_id !== session.payment_id) return;
  }
  const meta = payment.metadata;
  if (payment.status !== 'succeeded' || !paymentId.test(payment.payment_id ?? '') || payment.total_amount !== 0
    || payment.subscription_id != null || payment.business_id !== env.DODO_BUSINESS_ID
    || payment.checkout_session_id !== order.sessionId || meta?.access_request_id !== row.id
    || meta?.order_id !== order.orderId || meta?.billing_mode !== order.mode
    || typeof payment.customer?.email !== 'string' || payment.customer.email.trim().toLowerCase() !== row.contact?.email
    || !oneProduct(payment.product_cart, order.productId) || payment.refund_status != null
    || payment.refunds?.length || payment.disputes?.length) return;
  await store.save(row, { ...record, state: 'approved', approvedAt: new Date(now).toISOString(),
    trialCheckout: { ...order, paymentId: payment.payment_id, checkoutUrl: null } });
}

export async function startPersonalTrial(env, store, principal, config, release, now, fetcher, safeLink) {
  const id = await personalTrialId(store, config.mode, principal.email);
  let row = await store.get(id);
  if (!row) {
    const plan = config.plans['personal-annual'];
    const existing = (await store.list()).some(candidate => candidate.contact?.email?.trim().toLowerCase() === principal.email
      && candidate.contact.plan === 'personal' && candidate.trial
      && (candidate.trial.billing?.mode === config.mode || (config.mode === 'live_mode'
        && candidate.trial.activatedAt && !['development', 'personal-trial'].includes(candidate.trial.kind))));
    if (existing) reject(409, 'trial_unavailable');
    const { catalogue, identity } = await release(env);
    if (!compatiblePersonalMajor(plan.majorVersion, serverMajor(catalogue))) reject(409, 'licensed_major_unavailable');
    await store.insertOrder(id, { email: principal.email, plan: 'personal', name: principal.email }, {
      kind: 'personal-trial', state: 'trial_pending', serverMajorVersion: plan.majorVersion, maxUsers: plan.maxUsers,
      termsAcceptedAt: new Date(now).toISOString(), tokenHash: await hash(token()), linkExpiresAt: new Date(now).toISOString(),
      sourceRevision: catalogue.sourceRevision, releaseHash: identity,
      trialCheckout: { mode: config.mode, productId: config.trial.productId, orderId: crypto.randomUUID() },
    });
    row = await store.get(id);
  }
  const record = row.trial;
  if (row.contact?.email !== principal.email || record.kind !== 'personal-trial') reject(409, 'trial_unavailable');
  if (record.state === 'approved') return { requestId: id, ready: true };
  const order = record.trialCheckout;
  if (record.state !== 'trial_pending' || order.mode !== config.mode
    || order.productId !== config.trial.productId) reject(409, 'trial_unavailable');
  if (order.sessionId) {
    await confirmPersonalTrial(env, store, row, now, fetcher);
    if (row.trial.state === 'approved') return { requestId: id, ready: true };
    return { requestId: id, checkoutUrl: safeLink(order.checkoutUrl) };
  }
  if (order.startedAt) reject(409, 'trial_checkout_pending');
  const product = await dodo(env, `/products/${order.productId}`, 'GET', undefined, fetcher);
  if (product.product_id !== order.productId || product.is_recurring !== false || product.price?.type !== 'one_time_price'
    || product.price.price !== 0 || product.price.pay_what_you_want !== false || product.price.purchasing_power_parity === true
    || product.license_key_enabled || product.addons?.length) reject(409, 'trial_product_unavailable');
  if (config.trial.coupon) {
    const discount = await dodo(env, `/discounts/code/${encodeURIComponent(config.trial.coupon)}`, 'GET', undefined, fetcher);
    if (discount.business_id !== env.DODO_BUSINESS_ID || discount.type !== 'percentage' || discount.amount !== 10000
      || !Array.isArray(discount.restricted_to) || discount.restricted_to.length !== 1
      || discount.restricted_to[0] !== order.productId) reject(409, 'trial_coupon_unavailable');
  }
  const origin = env.CUSTOMER_ORIGIN ?? env.PUBLIC_INTAKE_ORIGIN;
  const checkout = {
    product_cart: [{ product_id: order.productId, quantity: 1 }],
    customer: { email: principal.email },
    metadata: { access_request_id: id, order_id: order.orderId, billing_mode: config.mode },
    ...(config.trial.coupon ? { discount_codes: [config.trial.coupon] } : {}),
    feature_flags: { allow_discount_code: false, allow_customer_editing_email: false },
    return_url: `${origin}/portal?trial=return&view=plans`,
  };
  const preview = await dodo(env, '/checkouts/preview', 'POST', checkout, fetcher);
  if (preview.current_breakup?.total_amount !== 0 || preview.payment_method_required !== false
    || !oneProduct(preview.product_cart, order.productId) || preview.product_cart[0].is_subscription !== false
    || preview.subscriptions?.length) reject(409, 'trial_product_unavailable');
  // The versioned write reserves creation across concurrent requests.
  await store.save(row, { ...record, trialCheckout: { ...order, startedAt: new Date(now).toISOString() } });
  let result;
  try {
    result = await dodo(env, '/checkouts', 'POST', checkout, fetcher);
  } catch (error) {
    if (error instanceof DodoError && [400, 422].includes(error.providerStatus)) {
      await store.save(row, record);
      reject(409, 'trial_checkout_rejected');
    }
    throw error;
  }
  if (!sessionId.test(result.session_id ?? '')) throw Error('Invalid trial checkout identity');
  const checkoutUrl = safeLink(result.checkout_url);
  await store.save(row, { ...row.trial, trialCheckout: { ...row.trial.trialCheckout,
    sessionId: result.session_id, checkoutUrl } });
  return { requestId: id, checkoutUrl };
}

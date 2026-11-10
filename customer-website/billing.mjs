const $ = id => document.getElementById(id);
const match = /^([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/.exec(location.hash.slice(1));
const selected = new URLSearchParams(location.search).get('request');
const requestId = match?.[1] ?? (/^[a-f0-9]{64}$/.test(selected ?? '') ? selected : null);
history.replaceState(null, '', !match && requestId ? `${location.pathname}?request=${requestId}` : location.pathname);
const base = requestId ? `/api/billing/${requestId}` : null;
if (requestId) $('back-to-portal').href = `/portal?request=${requestId}`;
async function api(action = '', value) {
  if (!base) throw Error('Reopen your private invitation to manage your subscription.');
  const response = await fetch(base + action, { method: value === undefined ? 'GET' : 'POST', cache: 'no-store',
    credentials: 'same-origin', headers: { ...(match ? { Authorization: `Bearer ${match[2]}` } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw Error(response.status === 404 ? 'Subscription access is not available for this invitation.'
      : result.error === 'checkout_rejected' ? 'Checkout was declined. Check the discount code and try again.'
      : result.error === 'checkout_unavailable' ? 'Checkout cannot be opened for this order. Return to the customer portal or contact support.'
      : 'The action could not be completed. Check your invitation or contact support.');
  }
  return response.json();
}
function show(value) {
  $('controls').hidden = false;
  const personal = value.plan === 'personal-annual';
  const checkout = value.status === 'offered' || (personal && value.status === 'checkout_pending');
  $('billing-title').textContent = personal ? 'Personal Self-Hosted' : 'Self-hosted subscription';
  $('billing-test').hidden = value.mode !== 'test_mode';
  $('details').textContent = ({
    offered: 'Continue to Dodo Payments to complete checkout.',
    checkout_pending: 'Payment is pending. Your order updates when Dodo confirms payment.',
    failed: 'Payment did not complete. If Dodo reports that payments are disabled, contact support before trying again.',
    cancelled: 'This subscription is cancelled.',
    expired: 'This subscription has expired.',
  })[value.status] ?? (value.paidThrough ? `Paid through ${new Date(value.paidThrough).toLocaleDateString()}.` : 'Payment has not been confirmed.');
  if (value.cancelAtPeriodEnd) $('details').textContent += ' Cancellation is scheduled for the end of the paid period.';
  $('coupon').closest('label').hidden = personal;
  $('checkout').hidden = !checkout;
  $('portal').hidden = checkout || !value.paidThrough || !value.hasCustomerPortal;
  $('cancel').hidden = checkout || !value.hasSubscription
    || !['active', 'on_hold', 'past_due', 'paused'].includes(value.status) || value.cancelAtPeriodEnd;
  $('license').hidden = checkout || !value.hasLicense;
  $('billing-actions').hidden = $('portal').hidden && $('cancel').hidden && $('license').hidden;
}
async function run(work) {
  const buttons = [...document.querySelectorAll('button')]; buttons.forEach(b => { b.disabled = true; });
  try { await work(); $('status').textContent = ''; } catch (error) { $('status').textContent = error.message; }
  finally { buttons.forEach(b => { b.disabled = false; }); }
}
function navigate(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/(^|\.)dodopayments\.com$/.test(url.hostname)) throw Error('Invalid billing destination.');
  location.assign(url.href);
}
$('checkout').addEventListener('submit', event => { event.preventDefault(); run(async () => navigate((await api('/checkout', $('coupon').value.trim() ? { coupon: $('coupon').value.trim() } : {})).checkoutUrl)); });
$('portal').addEventListener('click', () => run(async () => navigate((await api('/portal', {})).portalUrl)));
$('cancel').addEventListener('click', () => run(async () => { await api('/cancel', {}); show(await api()); }));
$('license').addEventListener('click', () => run(async () => {
  const result = await api('/license'); if (!result.license) throw Error('No license is available yet.');
  const url = URL.createObjectURL(new Blob([result.license], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'subscription-license.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
run(async () => {
  if (match) { const { establishInvitationSession } = await import('./portal-client.mjs'); await establishInvitationSession(requestId, match[2]).then(() => history.replaceState(null, '', `${location.pathname}?request=${requestId}`)).catch(() => {}); }
  show(await api());
});

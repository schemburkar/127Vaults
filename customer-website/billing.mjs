import {formatManageDate} from './manage-state.mjs';
import {confirmManageAction} from './manage-shell.mjs';
const match = /^([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/.exec(location.hash.slice(1));
const selected = new URLSearchParams(location.search).get('request');
const requestId = match?.[1] ?? (/^[a-f0-9]{64}$/.test(selected ?? '') ? selected : null);
export function mountBilling(root, requestId, bearer) {
  const $ = id => root.querySelector('#' + id);
  let current;
  const base = requestId ? '/api/billing/' + requestId : null;
  async function api(action = '', value) {
    if (!base) throw Error('Reopen your private invitation to manage your subscription.');
    const response = await fetch(base + action, { method: value === undefined ? 'GET' : 'POST', cache: 'no-store',
      credentials: 'same-origin', headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    if (!response.ok) {
      if(response.status===401)$('controls').hidden=true;
      const result = await response.json().catch(() => ({}));
      throw Error(response.status === 404 ? 'Subscription access is not available for this invitation.'
        : result.error === 'checkout_rejected' ? 'Checkout was declined. Check the discount code and try again.'
        : result.error === 'checkout_unavailable' ? 'Checkout cannot be opened for this order. Return to the customer portal or contact support.'
        : 'The action could not be completed. Check your invitation or contact support.');
    }
    return response.json();
  }
  function show(value) {
    current=value;
    $('controls').hidden = false;
    const personal = value.plan === 'personal-annual';
    const checkout = value.status === 'offered' || (personal && value.status === 'checkout_pending') || value.canRetryPayment || value.canResubscribe;
    $('billing-title').textContent = personal ? 'Personal Self-Hosted' : 'Self-hosted subscription';
    $('billing-test').hidden = value.mode !== 'test_mode';
    $('details').textContent = ({
      offered: 'Continue to Dodo Payments to complete checkout.',
      checkout_pending: 'Checkout is pending. Your order updates when Dodo confirms your subscription.',
      failed: value.canRetryPayment ? 'Payment did not complete. Retry to open a fresh checkout with Dodo.'
        : 'Payment did not complete. Contact support if you need help with this order.',
      cancelled: 'This subscription is cancelled.',
      expired: 'This subscription has expired.',
    })[value.status] ?? (value.paidThrough
      ? `${value.mode === 'test_mode' ? 'Test period ends' : 'Subscription active through'} ${formatManageDate(value.paidThrough)}.`
      : 'Your subscription has not been confirmed.');
    if (personal && value.status === 'active' && !value.accessReady) {
      $('details').textContent = 'We’re confirming your subscription. Downloads and license setup will appear in the portal when access is ready.';
    }
    if(value.settlement?.state==='settled_discounted') {
      const s=value.settlement,format=amount=>new Intl.NumberFormat(undefined,{style:'currency',currency:s.currency}).format(amount/(10**(new Intl.NumberFormat(undefined,{style:'currency',currency:s.currency}).resolvedOptions().maximumFractionDigits)));
      if (Number.isSafeInteger(s.normalAmount) && Number.isSafeInteger(s.discountAmount)) {
        $('details').textContent += ' Normal plan price: '+format(s.normalAmount)+'. Discount applied: '+format(s.discountAmount)+'.';
      }
      $('details').textContent += ' Amount due for this period: '+format(s.amount)+'.';
    }
    if (value.cancelAtPeriodEnd) $('details').textContent += ' Cancellation is scheduled for the end of the paid period.';
    $('coupon').closest('label').hidden = false;
    $('checkout').hidden = !checkout;
    $('resubscribe-terms').hidden = !value.canResubscribe || value.canRetryPayment;
    $('resubscribe-accept').required = !$('resubscribe-terms').hidden;
    $('checkout').querySelector('button').textContent = value.canRetryPayment ? 'Retry payment' : value.canResubscribe ? 'Subscribe again' : 'Continue to secure checkout';
    $('portal').hidden = checkout || !value.paidThrough || !value.hasCustomerPortal;
    $('cancel').hidden = checkout || !value.hasSubscription
      || !['active', 'on_hold', 'past_due', 'paused'].includes(value.status) || value.cancelAtPeriodEnd;
    $('license').hidden = checkout || !value.hasLicense;
    for(const id of ['portal','cancel','license'])$(id).closest('.manage-action').hidden=$(id).hidden;
    $('billing-actions').hidden = $('portal').hidden && $('cancel').hidden && $('license').hidden;
  }
  async function run(work) {
    const buttons = [...root.querySelectorAll('#controls button')]; buttons.forEach(b => { b.disabled = true; });
    try { await work(); $('status').textContent = ''; } catch (error) { $('status').textContent = error.message; }
    finally { buttons.forEach(b => { b.disabled = false; }); }
  }
  function navigate(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/(^|\.)dodopayments\.com$/.test(url.hostname)) throw Error('Invalid billing destination.');
    location.assign(url.href);
  }
  $('checkout').addEventListener('submit', event => { event.preventDefault(); run(async () => navigate((await api('/checkout', { ...($('coupon').value.trim() ? { coupon: $('coupon').value.trim() } : {}), ...(!$('resubscribe-terms').hidden ? { acceptTerms: $('resubscribe-accept').checked } : {}) })).checkoutUrl)); });
  $('portal').addEventListener('click', () => run(async () => navigate((await api('/portal', {})).portalUrl)));
  $('cancel').addEventListener('click', () => run(async () => { if(!await confirmManageAction('Cancel renewal',current?.paidThrough?'Stop the next renewal? Your current paid access continues through '+formatManageDate(current.paidThrough)+'.':'Stop this subscription’s next renewal?'))return;await api('/cancel', {}); show(await api()); }));
  $('license').addEventListener('click', () => run(async () => {
    const result = await api('/license'); if (!result.license) throw Error('No license is available yet.');
    const url = URL.createObjectURL(new Blob([result.license], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'subscription-license.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  run(async () => {
    if (bearer) { const { establishInvitationSession } = await import('./portal-client.mjs'); await establishInvitationSession(requestId, bearer).then(() => history.replaceState(null, '', `${location.pathname}?request=${requestId}`)).catch(() => {}); }
    show(await api());
  });
}
if (document.getElementById('back-to-portal')) {
  history.replaceState(null, '', !match && requestId ? location.pathname + '?request=' + requestId : location.pathname);
  if (requestId) {document.getElementById('back-to-portal').href = '/portal?view=subscriptions&request=' + requestId;document.getElementById('billing-reference').textContent='Subscription · Ref '+requestId.slice(0,8);}
  mountBilling(document, requestId, match?.[2]);
}

const $ = id => document.getElementById(id);
const match = /^([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/.exec(location.hash.slice(1));
history.replaceState(null, '', location.pathname);
const base = match ? `/api/billing/${match[1]}` : null;
async function api(action = '', value) {
  if (!base) throw Error('Reopen your private invitation to manage your subscription.');
  const response = await fetch(base + action, { method: value === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { Authorization: `Bearer ${match[2]}`, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw Error(response.status === 404 ? 'Subscription access is not available for this invitation.'
      : result.error === 'checkout_rejected' ? 'Checkout was declined. Check the discount code and try again.'
      : result.error === 'checkout_unavailable' ? 'Checkout is already pending or your server needs activation. Check payment status or contact support.'
      : 'The action could not be completed. Check your invitation or contact support.');
  }
  return response.json();
}
function show(value) {
  $('controls').hidden = false;
  $('details').textContent = `${value.plan}: ${value.status}. ${value.paidThrough ? `Paid through ${new Date(value.paidThrough).toLocaleString()}.` : 'Payment has not been confirmed.'}${value.cancelAtPeriodEnd ? ' Cancellation is scheduled.' : ''}`;
  $('checkout').hidden = value.status !== 'offered';
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
$('cancel').addEventListener('click', () => run(async () => show(await api('/cancel', {}))));
$('refresh').addEventListener('click', () => run(async () => show(await api('/refresh', {}))));
$('license').addEventListener('click', () => run(async () => {
  const result = await api('/license'); if (!result.license) throw Error('No license is available yet.');
  const url = URL.createObjectURL(new Blob([result.license], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'subscription-license.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
run(async () => show(await api()));

import { adminReady, adminFetch } from './admin-shell.mjs';
const isCoupons = document.body.dataset.adminPage === 'coupons';
const inbox = document.getElementById('inbox');
const panel = document.createElement('section'); panel.className = 'access-card';
const title = document.createElement('h2'); title.textContent = isCoupons ? 'Discount settings' : 'Subscription management'; panel.append(title);
const status = document.createElement('p'); status.setAttribute('role', 'status');
async function api(path, value) {
  const response = await adminFetch(`/api/access-admin/billing/${path}`, { method: value === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store', headers: value === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  if (!response.ok) throw Error(response.status === 404 ? 'Billing is disabled until Dodo account configuration is ready.' : 'Action failed. Check the request, plan, and operator session.');
  return response.json();
}
const form = document.createElement('form');
function field(label, name, type = 'text', value = '') {
  const wrapper = document.createElement('label'); wrapper.className = 'access-field'; wrapper.textContent = label;
  const input = document.createElement(['requestId', 'plan'].includes(name) ? 'select' : 'input'); input.name = name; if (input.tagName === 'INPUT') input.type = type; input.value = value;
  wrapper.append(input); form.append(wrapper);
  wrapper.hidden = isCoupons ? ['requestId', 'session'].includes(name) : ['basis', 'cycles', 'usage', 'expires', 'discount'].includes(name);
  return input;
}
const plan = field('Configured plan', 'plan');
const requestId = field('Customer', 'requestId');
const basis = field('Discount percentage (100 = free)', 'basis', 'number', '10');
const cycles = field('Number of discounted billing cycles', 'cycles', 'number', '12');
const usage = field('Maximum coupon redemptions', 'usage', 'number', '1');
const expires = field('Coupon expiry', 'expires', 'date');
const discount = field('Discount ID (for revoking a coupon)', 'discount');
plan.append(new Option('Billing is not configured', ''));
const session = field('Dodo checkout session ID (for recovering an interrupted checkout)', 'session');
function action(label, work) {
  const couponAction = ['Generate coupon', 'Revoke coupon'].includes(label);
  if (label !== 'Show configured plans' && couponAction !== isCoupons) return;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'button billing-action'; button.textContent = label;
  button.addEventListener('click', async () => { button.disabled = true;
    try { await work(); } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
  }); form.append(button);
}
action('Show configured plans', async () => { const result = await api('plans'); status.textContent = `${result.mode}: ${result.plans.map(p => `${p.id} (${p.maxUsers} users)`).join(', ')}`; });
action('Check reconciliation', async () => { const result = await api('health'); status.textContent = result.reconciliation
  ? `Last check: ${new Date(result.reconciliation.checked_at).toLocaleString()}. Checked: ${result.reconciliation.checked}. Failed: ${result.reconciliation.failed}. Pending events: ${result.pendingEvents}.`
  : 'Reconciliation has not run yet.'; });
action('Offer subscription', async () => {
  if (!/^[a-f0-9]{64}$/.test(requestId.value.trim())) throw Error('Choose an approved customer.');
  const result = await api(`${requestId.value.trim()}/offer`, { plan: plan.value.trim() });
  const url = URL.createObjectURL(new Blob([JSON.stringify({ refreshUrl: result.refreshUrl, refreshToken: result.refreshToken }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'subscription.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'Subscription offered. Securely give subscription.json to the server operator for automatic renewal. The existing private invitation now opens subscription management.';
});
action('Rotate server renewal credential', async () => {
  if (!/^[a-f0-9]{64}$/.test(requestId.value.trim())) throw Error('Choose an approved customer.');
  const result = await api(`${requestId.value.trim()}/rotate-refresh`, {});
  const url = URL.createObjectURL(new Blob([JSON.stringify({ refreshUrl: result.refreshUrl, refreshToken: result.refreshToken }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'subscription.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'The previous server renewal credential is invalid. Securely install the replacement subscription.json on this server.';
});
action('Recover interrupted checkout', async () => {
  if (!/^[a-f0-9]{64}$/.test(requestId.value.trim()) || !/^cks_[A-Za-z0-9]+$/.test(session.value.trim())) throw Error('Enter the request ID and actual Dodo checkout session ID.');
  const result = await api(`${requestId.value.trim()}/recover-checkout`, { sessionId: session.value.trim() }); status.textContent = `Recovered subscription: ${result.status}.`;
});
action('Show payment history', async () => {
  if (!/^[a-f0-9]{64}$/.test(requestId.value.trim())) throw Error('Choose an approved customer.');
  const result = await api(`${requestId.value.trim()}/payments`); status.textContent = result.events.map(v => `${new Date(v.at).toLocaleString()}: ${v.type}${v.amount === null ? '' : ` (${v.amount} ${v.currency ?? ''} minor units)`}`).join('; ') || 'No payment events recorded.';
});
action('Generate coupon', async () => {
  if (![basis, cycles, usage, expires].every(input => input.reportValidity()) || !expires.value || !plan.value) throw Error('Choose a plan and complete valid discount settings and expiry.');
  const result = await api('coupons', { plan: plan.value.trim(), basisPoints: Math.round(Number(basis.value) * 100), cycles: Number(cycles.value),
    usageLimit: Number(usage.value), expiresAt: `${expires.value}T23:59:59.000Z` });
  discount.value = result.discountId; status.textContent = `Coupon: ${result.code}. Discount ID: ${result.discountId}. Share the code privately.`;
});
action('Revoke coupon', async () => {
  if (!/^[A-Za-z0-9_-]+$/.test(discount.value)) throw Error('Enter the discount ID.');
  await api(`coupons/${discount.value}/revoke`, {}); status.textContent = 'Coupon revoked for future checkouts. Existing subscription discounts follow their agreed cycles.';
});
basis.min = '0.01'; basis.max = '100'; basis.step = '0.01'; cycles.min = '1'; cycles.max = '1200'; usage.min = '1'; usage.max = '10000';
form.addEventListener('submit', event => event.preventDefault());
status.setAttribute('aria-live', 'polite');
panel.append(form, status);
adminReady.then(async ready => {
  if (!ready) return;
  inbox.append(panel);
  if (!isCoupons) {
    try {
      const response = await adminFetch('/api/access-admin/requests');
      if (!response.ok) throw Error('Customers could not be loaded. Refresh to try again.');
      const result = await response.json();
      const placeholder = new Option('Choose an approved customer', ''); requestId.append(placeholder);
      for (const row of result.requests.filter(row => row.state === 'approved')) {
        requestId.append(new Option(`${row.email} · ${row.plan} · ${row.billingStatus || 'No subscription'}`, row.id));
      }
      if (requestId.options.length === 1) status.textContent = 'Approve an access request before offering a subscription.';
    } catch (error) { status.textContent = error.message; }
  }
  try {
    const result = await api('plans');
    plan.replaceChildren(new Option('Choose a plan', ''));
    for (const item of result.plans) plan.append(new Option(`${item.id} (${item.maxUsers} users)`, item.id));
    const note = document.createElement('p'); note.className = 'billing-note';
    note.textContent = `Billing mode: ${result.mode}. ${result.plans.map(p => `${p.id} (${p.maxUsers} users)`).join(', ')}`;
    inbox.prepend(note);
  } catch (error) {
    const note = document.createElement('p'); note.className = 'billing-note'; note.setAttribute('role', 'status'); note.textContent = error.message; inbox.prepend(note);
    if (error.message.startsWith('Billing is disabled')) form.querySelectorAll('button').forEach(button => { button.disabled = true; });
  }
}).catch(error => { status.textContent = error.message; });

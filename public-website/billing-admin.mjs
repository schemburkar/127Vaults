const inbox = document.getElementById('inbox');
const panel = document.createElement('section'); panel.className = 'access-card';
const title = document.createElement('h2'); title.textContent = 'Private subscriptions and coupons'; panel.append(title);
const status = document.createElement('p'); status.setAttribute('role', 'status');
async function api(path, value) {
  const response = await fetch(`/api/access-admin/billing/${path}`, { method: value === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store', headers: value === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  if (!response.ok) throw Error(response.status === 404 ? 'Billing is disabled until Dodo account configuration is ready.' : 'Action failed. Check the request, plan, and operator session.');
  return response.json();
}
const form = document.createElement('form');
function field(label, name, type = 'text', value = '') {
  const wrapper = document.createElement('label'); wrapper.className = 'access-field'; wrapper.textContent = label;
  const input = document.createElement('input'); input.name = name; input.type = type; input.value = value;
  wrapper.append(input); form.append(wrapper); return input;
}
const plan = field('Configured plan', 'plan');
const requestId = field('Access request ID (for a subscription offer)', 'requestId');
const basis = field('Discount in basis points: 1000 = 10%, 10000 = free', 'basis', 'number', '1000');
const cycles = field('Number of discounted billing cycles', 'cycles', 'number', '12');
const usage = field('Maximum coupon redemptions', 'usage', 'number', '1');
const expires = field('Coupon expiry', 'expires', 'date');
const discount = field('Discount ID (for revoking a coupon)', 'discount');
const session = field('Dodo checkout session ID (for recovering an interrupted checkout)', 'session');
function action(label, work) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'button'; button.textContent = label;
  button.addEventListener('click', async () => { button.disabled = true;
    try { await work(); } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
  }); form.append(button);
}
action('Show configured plans', async () => { const result = await api('plans'); status.textContent = `${result.mode}: ${result.plans.map(p => `${p.id} (${p.maxUsers} users)`).join(', ')}`; });
action('Check reconciliation', async () => { const result = await api('health'); status.textContent = result.reconciliation
  ? `Last check: ${new Date(result.reconciliation.checked_at).toLocaleString()}. Checked: ${result.reconciliation.checked}. Failed: ${result.reconciliation.failed}. Pending events: ${result.pendingEvents}.`
  : 'Reconciliation has not run yet.'; });
action('Show request IDs', async () => {
  const response = await fetch('/api/access-admin/requests', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw Error('Sign in again to view requests.');
  const result = await response.json();
  const list = document.createElement('datalist'); list.id = 'billing-request-ids'; document.getElementById(list.id)?.remove();
  for (const row of result.requests.filter(v => v.state === 'approved')) { const option = document.createElement('option'); option.value = row.id; option.label = row.email; list.append(option); }
  requestId.setAttribute('list', list.id); panel.append(list); requestId.focus(); status.textContent = 'Choose an approved request from the request ID field.';
});
action('Offer subscription', async () => {
  if (!/^[a-f0-9]{64}$/.test(requestId.value.trim())) throw Error('Enter the access request ID.');
  const result = await api(`${requestId.value.trim()}/offer`, { plan: plan.value.trim() });
  const url = URL.createObjectURL(new Blob([JSON.stringify({ refreshUrl: result.refreshUrl, refreshToken: result.refreshToken }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'subscription.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'Subscription offered. Securely give subscription.json to the server operator for automatic renewal. The existing private invitation now opens subscription management.';
});
action('Rotate server renewal credential', async () => {
  if (!/^[a-f0-9]{64}$/.test(requestId.value.trim())) throw Error('Enter the access request ID.');
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
  if (!/^[a-f0-9]{64}$/.test(requestId.value.trim())) throw Error('Enter the access request ID.');
  const result = await api(`${requestId.value.trim()}/payments`); status.textContent = result.events.map(v => `${new Date(v.at).toLocaleString()}: ${v.type}${v.amount === null ? '' : ` (${v.amount} ${v.currency ?? ''} minor units)`}`).join('; ') || 'No payment events recorded.';
});
action('Generate coupon', async () => {
  const result = await api('coupons', { plan: plan.value.trim(), basisPoints: Number(basis.value), cycles: Number(cycles.value),
    usageLimit: Number(usage.value), expiresAt: `${expires.value}T23:59:59.000Z` });
  discount.value = result.discountId; status.textContent = `Coupon: ${result.code}. Discount ID: ${result.discountId}. Share the code privately.`;
});
action('Revoke coupon', async () => {
  if (!/^[A-Za-z0-9_-]+$/.test(discount.value)) throw Error('Enter the discount ID.');
  await api(`coupons/${discount.value}/revoke`, {}); status.textContent = 'Coupon revoked for future checkouts. Existing subscription discounts follow their agreed cycles.';
});
panel.append(form, status); inbox.append(panel);

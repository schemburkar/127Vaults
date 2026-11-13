import { subscriptionActionReason } from './billing-actions.mjs';
import { loadRequests, billingModeLabel } from './request-data.mjs';
import { adminReady, adminFetch } from './admin-shell.mjs';
const isCoupons = document.body.dataset.adminPage === 'coupons';
const inbox = document.getElementById('inbox');
const panel = document.createElement('section'); panel.className = 'access-card';
const title = document.createElement('h2'); title.textContent = isCoupons ? 'Create a coupon' : 'Choose a customer'; panel.append(title);
const status = document.createElement('p'); status.setAttribute('role', 'status');
async function api(path, value) {
  const response = await adminFetch(`/api/access-admin/billing/${path}`, { method: value === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store', headers: value === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  if (!response.ok) throw Error(response.status === 404 ? 'Billing is disabled until Dodo account configuration is ready.' : 'Action failed. Check the request, plan, and operator session.');
  return response.json();
}
const form = document.createElement('form'); form.className = 'billing-workspace';
const intro = document.createElement('p'); intro.className = 'billing-intro';
intro.textContent = isCoupons ? 'Create a private discount for a plan. Existing subscriptions are unchanged until the code is redeemed.' : 'Select a customer to see their billing status and available actions. You are not searching Dodo or starting a charge here.';
panel.append(intro);
const selectedSummary = document.createElement('p'); selectedSummary.className = 'billing-note'; selectedSummary.setAttribute('aria-live', 'polite');
selectedSummary.textContent = 'Choose a customer to see their subscription details.';
let customers = [], billingReady = false, billingMode = null, availableOffers = [];
const actionButtons = [];

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
function section(title, explanation, advanced = false) {
  const container = document.createElement(advanced ? 'details' : 'section'); container.className = 'billing-section';
  const heading = document.createElement(advanced ? 'summary' : 'h3'); heading.textContent = title;
  const note = document.createElement('p'); note.textContent = explanation;
  container.append(heading, note); form.append(container); return container;
}
const groups = {};
if (isCoupons) {
  groups.create = section('Discount details', 'Choose the plan, percentage, duration and redemption limit. Creating a coupon does not charge a customer.');
  for (const input of [plan, basis, cycles, usage, expires]) groups.create.append(input.parentElement);
  groups.revoke = section('Revoke a coupon', 'Stops future redemptions. Existing agreed subscription discounts remain unchanged.', true);
  groups.revoke.append(discount.parentElement);
} else {
  form.prepend(requestId.parentElement, selectedSummary);
  groups.offer = section('Subscription offers', 'Commercial subscription offers are created here. Personal customers subscribe through Manage. Creating an offer does not charge anyone; the customer must complete checkout.');
  groups.offer.append(plan.parentElement);
  groups.payments = section('Payment history', 'Read recorded payment events for the selected customer. This does not refresh or charge their subscription.');
  groups.recovery = section('Recover a checkout', 'Use only when checkout was interrupted. Paste the actual Dodo checkout session ID for this customer.', true);
  groups.recovery.append(session.parentElement);
  groups.renewal = section('Replace the server renewal key', 'Invalidates the server’s old renewal credential and downloads a replacement. The server operator must install the new file.', true);
  groups.health = section('Billing service status', 'Check the last scheduled billing sync and pending events. This checks the service, not a customer payment.', true);
}
const definitions = {
  'Check reconciliation': ['health', 'Check billing sync status'],
  'Offer subscription': ['offer', 'Create subscription offer'],
  'Rotate server renewal credential': ['renewal', 'Replace renewal key'],
  'Recover interrupted checkout': ['recovery', 'Recover checkout'],
  'Show payment history': ['payments', 'View payment history'],
  'Generate coupon': ['create', 'Create coupon'],
  'Revoke coupon': ['revoke', 'Revoke coupon'],
};
function disabledReason(label) {
  if (!billingReady) return 'Billing configuration is unavailable.';
  if (isCoupons) {
    if (label === 'Revoke coupon') return /^[A-Za-z0-9_-]+$/.test(discount.value) ? '' : 'Enter the discount ID to revoke.';
    return plan.value && expires.value && [basis, cycles, usage].every(input => input.value !== '' && input.validity.valid) ? '' : 'Choose a plan and complete the discount details.';
  }
  return subscriptionActionReason({label, customer: customers.find(row => row.id === requestId.value), planId: plan.value, mode: billingMode, offerCount: availableOffers.length, sessionId: session.value});
}
function updateActions() {
  for (const {label,button,reason} of actionButtons) {
    const message = disabledReason(label); button.disabled = Boolean(message) || button.dataset.busy === 'true';
    reason.textContent = message; reason.hidden = !message;
  }
}
function action(label, work) {
  if (label === 'Show configured plans' || !groups[definitions[label]?.[0]]) return;
  const [group, display] = definitions[label];
  const wrap = document.createElement('div'); wrap.className = 'billing-action-block';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'button billing-action' + (['Offer subscription', 'Generate coupon'].includes(label) ? ' primary' : ' secondary'); button.textContent = display;
  const reason = document.createElement('p'); reason.className = 'action-reason'; reason.id = 'reason-' + actionButtons.length;
  button.setAttribute('aria-describedby', reason.id);
  actionButtons.push({label,button,reason});
  button.addEventListener('click', async () => {
    if (disabledReason(label)) return;
    if (['Rotate server renewal credential','Revoke coupon','Offer subscription'].includes(label) && !confirm(groups[group].querySelector('p').textContent + ' Continue?')) return;
    button.dataset.busy = 'true'; updateActions();
    status.textContent = display + '…';
    try { await work(); } catch (error) { status.textContent = error.message; }
    finally { button.dataset.busy = 'false'; updateActions(); }
  });
  wrap.append(button,reason); groups[group].append(wrap); updateActions();
}
form.addEventListener('input', updateActions);
form.addEventListener('change', updateActions);
requestId.addEventListener('change', () => {
  const row = customers.find(row => row.id === requestId.value);
  selectedSummary.textContent = row ? row.email + ' · ' + (row.billingStatus ? row.billingStatus + ' · ' + billingModeLabel(row) : 'No subscription. Personal customers subscribe through Manage; configured Commercial offers appear below.') : 'Choose a customer to see their subscription details.';
});
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
      const result = await loadRequests(adminFetch); customers = result.requests;
      const placeholder = new Option('Choose an approved customer', ''); requestId.append(placeholder);
      for (const row of result.requests.filter(row => row.state === 'approved')) {
        requestId.append(new Option(`${row.email} · ${row.plan} · ${row.billingStatus ? row.billingStatus + ' · ' + billingModeLabel(row) : 'No subscription'}`, row.id));
      }
      if (requestId.options.length === 1) status.textContent = 'Approve an access request before offering a subscription.';
    } catch (error) { status.textContent = error.message; }
  }
  try {
    const result = await api('plans');
    billingMode = result.mode; availableOffers = result.plans.filter(item => item.plan === 'commercial');
    plan.replaceChildren(new Option(isCoupons || availableOffers.length ? 'Choose a plan' : 'No Commercial offer plans configured', ''));
    for (const item of (isCoupons ? result.plans : availableOffers)) plan.append(new Option(`${item.id} (${item.maxUsers} users)`, item.id));
    const note = document.createElement('p'); note.className = 'billing-note';
    note.textContent = `${result.mode === 'live_mode' ? 'Live billing — real customer payments' : 'Test billing — no live payments'}. ${result.plans.map(p => `${p.id} (${p.maxUsers} users)`).join(', ')}`;
    inbox.prepend(note); billingReady = true; updateActions();
  } catch (error) {
    const note = document.createElement('p'); note.className = 'billing-note'; note.setAttribute('role', 'status'); note.textContent = error.message; inbox.prepend(note);
    billingReady = false; updateActions();
  }
}).catch(error => { status.textContent = error.message; });

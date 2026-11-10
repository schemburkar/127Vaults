import { portalApi, establishInvitationSession, parseInvitation } from './portal-client.mjs';
import { mountBilling } from './billing.mjs';
const $ = id => document.getElementById(id);
let challengeId;
async function run(work) {
  const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
  try { await work(); } catch (error) { $('portal-status').textContent = error.message; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
function link(label, path, primary = false) { const node = document.createElement('a'); node.className = `button ${primary ? 'primary' : 'secondary'}`; node.textContent = label; node.href = path; return node; }
const query = new URLSearchParams(location.search);
function element(tag, label, className) {
  const node = document.createElement(tag);
  if (label) node.textContent = label;
  if (className) node.className = className;
  return node;
}
const planName = plan => ({
  personal: 'Personal Self-Hosted', commercial: 'Commercial Self-Hosted', cloud: '127Vaults Cloud',
})[plan?.startsWith('commercial-') ? 'commercial' : plan] ?? plan;
function renderPlans(value) {
  $('portal-plans').hidden = value.scope !== 'email';
  $('personal-buy').hidden = !value.canBuyPersonal;
  const target = $('personal-installation');
  const selected = target.value;
  const options = value.requests.filter(row => row.convertible);
  target.replaceChildren(element('option', 'Set up a new installation'));
  target.firstChild.value = '';
  for (const row of options) {
    const option = element('option', `Convert ${orderKind(row)} · Server ${row.installationId.slice(0, 8)}`);
    option.value = row.id;
    target.append(option);
  }
  if (options.some(row => row.id === selected)) target.value = selected;
  target.closest('label').hidden = !options.length;
  const order = value.requests.find(row => row.plan === 'personal' && row.billingStatus);
  $('personal-plan-action').replaceChildren();
  if (!value.canBuyPersonal && order && value.scope === 'email') {
    const label = ({ offered: 'Continue checkout', checkout_pending: 'Continue checkout', failed: 'Retry payment' })[order.billingStatus] ?? 'Manage plan';
    $('personal-plan-action').append(orderLink(order, label));
  }
  $('personal-test').hidden = value.purchaseMode !== 'test_mode';
  $('personal-terms-copy').textContent = value.purchaseMode === 'test_mode'
    ? ' for this test checkout. Use a Dodo test card.'
    : ' and agree to annual billing at $20 USD plus applicable tax.';
}
const billingPanel = $('billing-panel').cloneNode(true);
function orderLink(row, label) {
  const order = link(label, `/billing?request=${encodeURIComponent(row.id)}`);
  order.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const panel = billingPanel.cloneNode(true);
    $('billing-panel').replaceWith(panel);
    panel.querySelector('#billing-reference').textContent = `Order ${row.id.slice(0, 8)} · ${orderStatus(row)}`;
    if (row.state === 'approved') {
      panel.querySelector('#billing-download').append(link('Downloads and license', `/trial?request=${encodeURIComponent(row.id)}`));
    }
    panel.showModal();
    mountBilling(panel, row.id);
  });
  return order;
}
function orderStatus(row) {
  if (row.cancelAtPeriodEnd && row.billingStatus === 'active') return 'Cancellation scheduled';
  return ({
    offered: 'Ready for checkout', checkout_pending: 'Payment pending', active: 'Active',
    failed: 'Payment failed', cancelled: 'Cancelled', expired: 'Expired', on_hold: 'On hold',
    past_due: 'Past due', paused: 'Paused', refunded: 'Refunded', disputed: 'Disputed',
  })[row.billingStatus] ?? (row.billingStatus ? 'Processing' : ({
    approved: row.expiresAt && Date.parse(row.expiresAt) <= Date.now() ? 'Expired' : 'Approved',
    requested: 'Awaiting review', closed: 'Closed', rejected: 'Declined', converted: 'Converted to Personal',
  })[row.state] ?? 'Pending');
}
function orderKind(row) {
  if (row.billingMode === 'test_mode') return 'Test subscription';
  if (row.kind === 'development') return 'Development license';
  if (row.billingStatus) return 'Subscription';
  if (row.kind === 'trial') return 'Unpaid trial';
  return 'Access request';
}
function renderOrders(value) {
  const rows = [...value.requests].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const returning = query.get('billing') === 'return';
  // Older hosted sessions return without the order reference.
  const selected = query.get('request') ?? (returning
    ? rows.filter(row => row.checkoutStartedAt).sort((a, b) => Date.parse(b.checkoutStartedAt) - Date.parse(a.checkoutStartedAt))[0]?.id
    : undefined);
  const current = rows.find(row => row.id === selected);
  const notice = $('portal-return');
  notice.hidden = !returning || !current;
  if (!notice.hidden) {
    const confirmed = current.state === 'approved' && Boolean(current.paidThrough);
    const detail = confirmed ? `${current.billingMode === 'test_mode' ? 'Test payment' : 'Payment'} confirmed. Your downloads and license setup are ready.`
      : current.billingStatus === 'failed' ? 'Payment did not complete. Access is still locked.'
      : 'We’re verifying your payment. Downloads will appear here once access is ready.';
    notice.textContent = `${planName(current.plan)} — ${detail}`;
  }
  const body = $('portal-requests');
  body.replaceChildren();
  $('portal-orders').hidden = !rows.length;
  if (current) {
    rows.splice(rows.indexOf(current), 1);
    rows.unshift(current);
  }
  for (const row of rows) {
    const entry = element('tr');
    if (row === current) entry.className = 'portal-selected-order';
    const name = element('th', planName(row.plan));
    name.scope = 'row';
    name.append(element('small', `Ref ${row.id.slice(0, 8)}`));
    if (row.installationId) {
      const installation = element('small', `Server ${row.installationId.slice(0, 8)}`);
      installation.title = row.installationId;
      name.append(installation);
    }
    if (row.maxUsers) name.append(element('small', `${row.maxUsers} licensed users`));
    const kind = element('td');
    kind.append(element('span', orderKind(row), row.billingMode === 'test_mode' || row.kind === 'development' ? 'portal-state' : ''));
    const end = row.paidThrough ?? row.expiresAt;
    const dates = element('td', end ? new Date(end).toLocaleDateString() : '—');
    if (end) dates.append(element('small', row.paidThrough
      ? row.billingMode === 'test_mode' ? 'Test period ends' : 'Paid through'
      : 'License expires'));
    const action = element('td');
    const actions = element('div', '', 'portal-table-actions');
    if (row.state === 'approved') {
      actions.append(link('Downloads and license', `/trial?request=${encodeURIComponent(row.id)}`));
      const installer = element('button', 'Installer link', 'button secondary');
      installer.type = 'button';
      installer.addEventListener('click', () => run(async () => {
        const result = await portalApi('installer-link', { requestId: row.id });
        installer.replaceWith(link('Open installer link', result.link));
      }));
      if (!row.conversion) actions.append(installer);
    }
    if (row.billingStatus && value.scope !== 'installer') {
      const label = ['offered', 'checkout_pending'].includes(row.billingStatus) ? 'Continue checkout'
        : row.state === 'approved' ? 'Manage billing' : 'Order details';
      actions.append(orderLink(row, label));
    }
    action.append(actions);
    entry.append(name, kind, element('td', orderStatus(row)), dates, action);
    body.append(entry);
  }
}
async function billingPost(path, value) {
  const response = await fetch('/api/billing/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  if (!response.ok) throw Error('Checkout could not be opened. Check your order below or contact support.');
  return response.json();
}
$('personal-buy').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const convertRequestId = $('personal-installation').value;
    const { requestId } = await billingPost('personal-order', { acceptTerms: $('personal-consent').checked,
      ...(convertRequestId ? { convertRequestId } : {}) });
    try {
      const { checkoutUrl } = await billingPost(`${encodeURIComponent(requestId)}/checkout`, {});
      const destination = new URL(checkoutUrl);
      if (destination.protocol !== 'https:' || !/(^|\.)dodopayments\.com$/.test(destination.hostname)) throw Error('Invalid checkout destination.');
      location.assign(destination.href);
    } catch (error) {
      await account();
      throw error;
    }
  });
});
async function account() {
  let value = await portalApi('me');
  if (query.get('billing') === 'return') {
    const selected = query.get('request');
    const pending = selected && value.requests.find(row => row.id === selected && row.state === 'purchase_pending'
      && ['active', 'checkout_pending'].includes(row.billingStatus));
    if (pending) {
      try {
        await billingPost(`${encodeURIComponent(pending.id)}/refresh`, {});
        value = await portalApi('me');
      } catch {
        // A delayed confirmation should still show the order and its current status.
      }
    }
  }
  $('portal-login').hidden = true; $('portal-account').hidden = false;
  $('portal-identity').textContent = value.email ? `Signed in as ${value.email}` : value.scope === 'installer' ? 'Signed in with an installer invitation. This session opens installation downloads and licensing only.' : 'Signed in with an invitation. This session opens only that invitation.';
  const cloud = $('portal-cloud');
  const tenants = value.cloudTenants ?? [];
  cloud.hidden = !tenants.length && !value.cloudUnavailable;
  const cloudCards = $('portal-cloud-tenants');
  cloudCards.replaceChildren();
  if (value.cloudUnavailable) cloudCards.textContent = 'Cloud details are temporarily unavailable.';
  for (const tenant of tenants) {
    if (typeof tenant.slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tenant.slug)) continue;
    const canonicalUrl = `https://cloud.127vaults.com/t/${tenant.slug}/`;
    if (tenant.canonicalUrl !== canonicalUrl) continue;
    const card = document.createElement('article'); card.className = 'access-card portal-request';
    const title = document.createElement('h3'); title.textContent = tenant.slug;
    const summary = document.createElement('p');
    const state = { reserved: 'Reserved', prepared: 'Awaiting activation', active: 'Active', suspended: 'Suspended' }[tenant.state] ?? tenant.state;
    summary.textContent = `${state} · ${tenant.maxActiveUsers} seats allocated by 127Vaults`;
    const note = document.createElement('p'); note.textContent = 'Billing and seat purchases are arranged with 127Vaults during the pilot.';
    card.append(title, summary, note);
    if (tenant.state === 'active') {
      const signIn = document.createElement('p');
      signIn.textContent = 'Family settings require a separate vault-owner sign-in.';
      card.append(link('Open family settings', `${canonicalUrl}?settings=family`), signIn);
    }
    cloudCards.append(card);
  }
  renderPlans(value);
  renderOrders(value);
  $('portal-status').textContent = value.requests.length || value.canBuyPersonal || !cloud.hidden ? '' : 'There are no available requests for this session. Verify your email or use a current invitation.';
}
$('email-start').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const result = await portalApi('start', { email: $('email').value.trim() }); challengeId = result.challengeId;
  $('email-complete').hidden = false; $('portal-status').textContent = result.message; $('code').value = ''; $('code').focus();
}); });
$('email-complete').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  await portalApi('complete', { challengeId, code: $('code').value.trim() }); $('code').value = ''; await account();
}); });
$('invite-login').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const value = parseInvitation($('invitation').value.trim()); await establishInvitationSession(value.requestId, value.token);
  $('invitation').value = ''; await account();
}); });
$('portal-logout').addEventListener('click', () => run(async () => {
  await portalApi('logout', {}); $('portal-account').hidden = true; $('portal-login').hidden = false;
  $('portal-cloud').hidden = true; $('portal-cloud-tenants').replaceChildren();
  $('personal-consent').checked = false;
  $('portal-requests').replaceChildren(); $('portal-identity').textContent = ''; $('portal-status').textContent = 'Signed out.';
}));
account().catch(error => { $('portal-login').hidden = false; $('portal-status').textContent = error.status === 401 ? '' : error.message; });

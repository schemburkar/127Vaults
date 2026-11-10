import { portalApi, establishInvitationSession, parseInvitation } from './portal-client.mjs';
const $ = id => document.getElementById(id);
let challengeId;
async function run(work) {
  const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
  try { await work(); } catch (error) { $('portal-status').textContent = error.message; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
function link(label, path, primary = false) { const node = document.createElement('a'); node.className = `button ${primary ? 'primary' : 'secondary'}`; node.textContent = label; node.href = path; return node; }
async function account() {
  const value = await portalApi('me');
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
  $('portal-requests').replaceChildren();
  if (value.canBuyPersonal) {
    const buy = document.createElement('form');
    buy.className = 'access-card portal-request';
    const title = document.createElement('h2');
    title.textContent = 'Buy Personal Self-Hosted';
    const terms = document.createElement('label');
    const consent = document.createElement('input');
    consent.type = 'checkbox';
    consent.required = true;
    const agreement = document.createElement('a');
    agreement.href = 'https://127vaults.com/terms';
    agreement.textContent = 'license terms';
    terms.append(consent, ' I accept the ', agreement, ' and agree to annual billing at $20 USD plus applicable tax.');
    const submit = document.createElement('button');
    submit.className = 'button primary';
    submit.textContent = 'Continue to checkout';
    buy.append(title, terms, submit);
    buy.addEventListener('submit', event => {
      event.preventDefault();
      run(async () => {
        const response = await fetch('/api/billing/personal-order', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptTerms: consent.checked }),
        });
        if (!response.ok) throw Error('Could not start the order. Try again or contact support.');
        const { requestId } = await response.json();
        location.assign(`/billing?request=${encodeURIComponent(requestId)}`);
      });
    });
    $('portal-requests').append(buy);
  }
  for (const row of value.requests) {
    const card = document.createElement('article'); card.className = 'access-card portal-request';
    const heading = document.createElement('div'); heading.className = 'portal-request-heading';
    const title = document.createElement('h2'); title.textContent = { personal: 'Personal Self-Hosted', commercial: 'Commercial Self-Hosted' }[row.plan] ?? row.plan;
    const status = document.createElement('span'); status.className = 'portal-state';
    status.textContent = { approved: 'Approved', purchase_pending: 'Purchase', requested: 'Awaiting review', closed: 'Closed', rejected: 'Not approved' }[row.state] ?? row.state;
    heading.append(title, status); card.append(heading);
    const facts = document.createElement('dl'); facts.className = 'portal-facts';
    const fact = (label, value, className) => {
      const group = document.createElement('div'); if (className) group.className = className;
      const term = document.createElement('dt'); term.textContent = label;
      const detail = document.createElement('dd'); detail.textContent = value;
      group.append(term, detail); facts.append(group);
    };
    if (row.installationId) fact('Server installation', row.installationId, 'portal-installation');
    if (row.expiresAt) fact('License expires', new Date(row.expiresAt).toLocaleString());
    if (row.maxUsers) fact('Licensed vault users', row.maxUsers);
    if (row.billingStatus) fact('Subscription', `${row.billingStatus}${row.cancelAtPeriodEnd ? ' · Cancellation scheduled' : ''}`);
    if (facts.children.length) card.append(facts);
    if (row.state === 'approved') {
      const actions = document.createElement('div'); actions.className = 'portal-actions';
      actions.append(link('Downloads and license', `/trial?request=${encodeURIComponent(row.id)}`, true));
      const installer = document.createElement('button'); installer.type = 'button'; installer.className = 'button secondary'; installer.textContent = 'Get installer invitation';
      installer.addEventListener('click', () => run(async () => {
        const value = await portalApi('installer-link', { requestId: row.id });
        const fresh = link('Open installer invitation (valid for one hour)', value.link); installer.replaceWith(fresh);
      })); actions.append(installer);
      if (row.billingStatus && value.scope !== 'installer') actions.append(link('Billing, invoices and cancellation', `/billing?request=${encodeURIComponent(row.id)}`));
      card.append(actions);
    } else if (row.state === 'purchase_pending') {
      card.append(link('Open billing and check payment', `/billing?request=${encodeURIComponent(row.id)}`, true));
    } else { const note = document.createElement('p'); note.className = 'portal-request-note'; note.textContent = row.state === 'requested' ? 'Your request is waiting for review. Signing in does not approve access.' : 'This request is not currently approved. Contact your inviter if you need assistance.'; card.append(note); }
    $('portal-requests').append(card);
  }
  $('portal-status').textContent = value.requests.length || !cloud.hidden ? '' : 'There are no available requests for this session. Verify your email or use a current invitation.';
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
  $('portal-requests').replaceChildren(); $('portal-identity').textContent = ''; $('portal-status').textContent = 'Signed out.';
}));
account().catch(error => { $('portal-login').hidden = false; $('portal-status').textContent = error.status === 401 ? '' : error.message; });

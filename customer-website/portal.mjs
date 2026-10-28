import { portalApi, establishInvitationSession, parseInvitation } from './portal-client.mjs';
const $ = id => document.getElementById(id);
let challengeId;
async function run(work) {
  const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
  try { await work(); } catch (error) { $('portal-status').textContent = error.message; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
function link(label, path) { const node = document.createElement('a'); node.className = 'button'; node.textContent = label; node.href = path; return node; }
async function account() {
  const value = await portalApi('me');
  $('portal-login').hidden = true; $('portal-account').hidden = false;
  $('portal-identity').textContent = value.email ? `Signed in as ${value.email}` : value.scope === 'installer' ? 'Signed in with an installer invitation. This session opens installation downloads and licensing only.' : 'Signed in with an invitation. This session opens only that invitation.';
  $('portal-requests').replaceChildren();
  for (const row of value.requests) {
    const card = document.createElement('article'); card.className = 'access-card';
    const title = document.createElement('h2'); title.textContent = row.plan;
    const status = document.createElement('p'); status.textContent = `Access: ${row.state}${row.billingStatus ? ` · Subscription: ${row.billingStatus}` : ''}${row.cancelAtPeriodEnd ? ' · Cancellation scheduled' : ''}`;
    card.append(title, status);
    if (row.installationId) { const installation = document.createElement('p'); installation.textContent = `Installation: ${row.installationId}`; card.append(installation); }
    if (row.expiresAt) { const expiry = document.createElement('p'); expiry.textContent = `License expires ${new Date(row.expiresAt).toLocaleString()}.`; card.append(expiry); }
    if (row.maxUsers) { const users = document.createElement('p'); users.textContent = `Licensed vault users: ${row.maxUsers}`; card.append(users); }
    if (row.state === 'approved') {
      card.append(link('Downloads and license', `/trial?request=${encodeURIComponent(row.id)}`));
      const installer = document.createElement('button'); installer.type = 'button'; installer.className = 'button'; installer.textContent = 'Get installer invitation';
      installer.addEventListener('click', () => run(async () => {
        const value = await portalApi('installer-link', { requestId: row.id });
        const fresh = link('Open installer invitation (valid for one hour)', value.link); installer.replaceWith(fresh);
      })); card.append(installer);
      if (row.billingStatus && value.scope !== 'installer') card.append(link('Billing, invoices and cancellation', `/billing?request=${encodeURIComponent(row.id)}`));
    } else { const note = document.createElement('p'); note.textContent = row.state === 'requested' ? 'Your request is waiting for review. Signing in does not approve access.' : 'This request is not currently approved. Contact your inviter if you need assistance.'; card.append(note); }
    $('portal-requests').append(card);
  }
  $('portal-status').textContent = value.requests.length ? '' : 'There are no available requests for this session. Verify your email or use a current invitation.';
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
  $('portal-requests').replaceChildren(); $('portal-identity').textContent = ''; $('portal-status').textContent = 'Signed out.';
}));
account().catch(error => { if (error.status !== 401) $('portal-status').textContent = error.message; });

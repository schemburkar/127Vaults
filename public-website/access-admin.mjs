const $ = id => document.getElementById(id);
let token = '';
let emailDryRun = false;
let activeMenu = null;
function closeMenu(restoreFocus = false) {
  if (!activeMenu) return;
  const { popup, trigger } = activeMenu;
  activeMenu = null;
  popup.hidePopover(); trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger.focus();
}
function openMenu(popup, trigger, last = false) {
  if (activeMenu?.popup === popup) { closeMenu(true); return; }
  closeMenu(); activeMenu = { popup, trigger };
  popup.showPopover(); trigger.setAttribute('aria-expanded', 'true');
  const rect = trigger.getBoundingClientRect(), gap = 6, edge = 12;
  const left = Math.max(edge, Math.min(rect.right - popup.offsetWidth, innerWidth - popup.offsetWidth - edge));
  const below = rect.bottom + gap;
  const top = below + popup.offsetHeight <= innerHeight - edge ? below : Math.max(edge, rect.top - popup.offsetHeight - gap);
  popup.style.left = `${left}px`; popup.style.top = `${top}px`;
  const buttons = popup.querySelectorAll('button:not(:disabled)');
  buttons[last ? buttons.length - 1 : 0]?.focus();
}
window.addEventListener('resize', () => closeMenu());
document.addEventListener('scroll', event => {
  if (activeMenu && !activeMenu.popup.contains(event.target)) closeMenu();
}, true);
const status = message => { $('desk-status').textContent = message; };
async function api(path = '', value) {
  const response = await fetch(`/api/access-admin/requests${path}`, { method: value === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: value === undefined ? undefined : JSON.stringify(value), cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401) { $('inbox').hidden = true; $('logout').hidden = true; $('operator-login').hidden = false; clearInvitation(); $('requests').replaceChildren(); }
    if (error.error === 'email_not_configured') throw Error('Cloudflare email is not configured. Copy the invitation and send it manually.');
    if (error.error === 'email_already_attempted') throw Error('Email was already attempted. Refresh its status. If needed, replace the private link before sending another invitation.');
    throw Error(error.error === 'owner_required' ? 'This action requires owner access.' : error.error === 'access_required' ? 'Access key not accepted.' : error.error === 'state_changed'
      ? 'This request has changed. Refresh before approving it again.' : 'The action could not be completed. Refresh and try again.');
  }
  return response;
}
function clearInvitation() {
  for (const id of ['invite-to', 'invite-subject', 'invite-message']) $(id).value = '';
  $('invitation').hidden = true;
}
async function refresh() {
  const data = await (await api()).json();
  emailDryRun = data.emailDryRun === true;
  $('request-alert-status').textContent = data.requestAlertsEnabled === true ? 'New-request email alerts are on.' : 'New-request email alerts are off.';
  $('operator-login').hidden = true; $('inbox').hidden = false;
  $('logout').hidden = false;
  closeMenu();
  document.querySelectorAll('.request-menu-items').forEach(popup => popup.remove());
  $('requests').replaceChildren();
  const view = $('request-view').value;
  const rows = data.requests.filter(row => view === 'all' || (view === 'archived' ? Boolean(row.archivedAt) : !row.archivedAt)).reverse();
  status(`Operator access - ${rows.length} request${rows.length === 1 ? '' : 's'}`);
  if (!rows.length) {
    const empty = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 9;
    cell.className = 'desk-empty'; cell.textContent = view === 'archived' ? 'No archived requests.' : 'No requests to show.';
    empty.append(cell); $('requests').append(empty);
  }
  for (const row of rows) {
    const card = document.createElement('tr');
    const cell = value => { const td = document.createElement('td'); td.textContent = value; card.append(td); return td; };
    const email = cell(row.email); email.className = 'request-email';
    if (row.contactName) { const name = document.createElement('small'); name.textContent = row.contactName; email.append(name); }
    if (row.requestAlertState) { const note = document.createElement('small'); note.textContent = ({ sending: 'Email alert pending', accepted: 'Email alert submitted', unconfirmed: 'Email alert unconfirmed' })[row.requestAlertState] || 'Email alert unconfirmed'; email.append(note); }
    cell(row.organization || '—'); cell(row.plan.charAt(0).toUpperCase() + row.plan.slice(1));
    const requested = cell(''); const time = document.createElement('time'); time.dateTime = row.receivedAt;
    time.textContent = new Date(row.receivedAt).toLocaleString(); requested.append(time);
    cell(row.requestedSeats ?? '—');
    const usersCell = cell(row.maxUsers ?? '—');
    const state = cell(''); const badge = document.createElement('span'); badge.className = 'request-state';
    badge.textContent = row.state === 'rejected' ? 'Declined' : row.state === 'requested' ? 'Pending' : row.state.charAt(0).toUpperCase() + row.state.slice(1);
    state.append(badge);
    if (row.archivedAt) { const archived = document.createElement('small'); archived.textContent = 'Archived'; state.append(archived); }
    if (row.replacementRequest) { const pending = document.createElement('small'); pending.textContent = `Replacement requested: ${row.replacementRequest.installationId}. ${row.replacementRequest.reason}`; state.append(pending); }
    if (row.expiresAt) { const expiry = document.createElement('small'); expiry.textContent = `Expires ${new Date(row.expiresAt).toLocaleDateString()}`; state.append(expiry); }
    const emailStates = { not_sent: 'Not sent', accepted: 'Accepted', queued: 'Queued', bounced: 'Bounced', sending: 'Sending', unknown: 'Unconfirmed' };
    cell(row.state === 'approved' ? (emailDryRun && row.emailState !== 'not_sent' ? 'Simulated' : emailStates[row.emailState] || '—') : '—');
    const actionCell = cell(''), menuLabel = document.createElement('button');
    menuLabel.type = 'button'; menuLabel.className = 'request-menu-trigger'; menuLabel.textContent = 'Actions';
    menuLabel.setAttribute('aria-label', `Actions for ${row.email}`); menuLabel.setAttribute('aria-haspopup', 'menu');
    menuLabel.setAttribute('aria-expanded', 'false'); menuLabel.setAttribute('aria-controls', `request-actions-${row.id}`);
    const menuItems = document.createElement('div'); menuItems.className = 'request-menu-items';
    menuItems.id = `request-actions-${row.id}`; menuItems.setAttribute('popover', 'auto'); menuItems.setAttribute('role', 'menu');
    menuItems.setAttribute('aria-label', `Actions for ${row.email}`);
    actionCell.append(menuLabel); document.body.append(menuItems);
    menuLabel.addEventListener('click', () => openMenu(menuItems, menuLabel));
    menuLabel.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); openMenu(menuItems, menuLabel, event.key === 'ArrowUp'); }
    });
    menuItems.addEventListener('toggle', event => {
      if (event.newState === 'closed') {
        menuLabel.setAttribute('aria-expanded', 'false');
        if (activeMenu?.popup === menuItems) activeMenu = null;
      }
    });
    menuItems.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
      if (event.key === 'Tab') { closeMenu(true); return; }
      const buttons = [...menuItems.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    });
    const act = (label, action, value, confirmation) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.setAttribute('role', 'menuitem'); button.tabIndex = -1;
      button.addEventListener('click', async () => {
        if (confirmation && !confirm(confirmation)) return;
        closeMenu();
        button.disabled = true;
        try {
          const response = await api(`/${row.id}/${action}`, typeof value === 'function' ? value() : value);
          if (action === 'revocation') {
            const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a');
            a.href = url; a.download = 'trial-revocation.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            status('Install this revocation on the trial server to stop its licensed writes. Download access alone cannot revoke an offline server.'); return;
          }
          const data = await response.json();
          await refresh();
          if (action === 'send-invitation') {
            if (emailDryRun) { status(`Dry-run email result: ${data.emailState}. Saved locally; no real email was sent.`); return; }
            status(data.emailState === 'accepted' ? 'Invitation accepted by the recipient mail server.'
              : data.emailState === 'queued' ? 'Cloudflare queued the invitation. This does not confirm inbox delivery.'
                : data.emailState === 'bounced' ? 'The invitation bounced. Contact the requester separately.'
                  : 'Sending was not confirmed. Check Cloudflare activity; replace the private link before another attempt.');
            return;
          }
          if (data.message && data.email) {
            clearInvitation(); $('invite-to').value = data.email; $('invite-subject').value = data.subject; $('invite-message').value = data.message;
            $('invitation').hidden = false; $('invite-message').focus();
            status('Invitation ready to review.');
          } else if (action === 'replace-installation') status('Replacement license issued. The customer can use the existing private link to download it. Review and send the replacement invitation if needed.');
          else status(data.hasRevocation ? 'Link closed. Download the signed revocation and install it on the trial server to revoke its installed license.' : 'Request updated.');
        } catch (error) { status(error.message); }
        finally { button.disabled = false; }
      });
      menuItems.append(button);
    };
    if (row.state === 'requested') {
      const users = document.createElement('input'); users.type = 'number'; users.min = '1'; users.max = '100'; users.value = String(row.maxUsers ?? row.requestedSeats ?? 1);
      users.className = 'request-users'; users.setAttribute('aria-label', `Maximum vault users for ${row.email}`); usersCell.replaceChildren(users);
      if (['personal', 'commercial'].includes(row.plan)) act('Approve', 'approve', () => ({ maxUsers: Number(users.value) }), `Approve a 10-day trial for ${row.email}?`);
      act('Decline', 'reject', {}, 'Decline this access request?');
    }
    if (row.state === 'approved') {
      if (row.replacementRequest) act('Issue replacement license', 'replace-installation', { installationId: row.replacementRequest.installationId, retired: true }, `Issue a replacement license for ${row.replacementRequest.installationId}? The customer confirmed the old installation is retired. Preserve the original expiry and limits. The signed old-license revocation must be applied on an old server if reachable.`);
      if ((row.replacementRequest || row.replacementCount)) act('Download old license revocation', 'revocation', undefined);
      if (row.canPreviewInvitation) act('Review invitation', 'invitation', undefined);
      if (row.canSendEmail) act(emailDryRun ? 'Send invitation (dry run)' : 'Send invitation', 'send-invitation', {}, emailDryRun ? `Simulate the invitation to ${row.email}? No real email will be sent.` : `Send the approved 10-day trial invitation to ${row.email} through Cloudflare?`);
      act('Replace private link', 'rotate', {}, 'Invalidate the old link and create a replacement? The trial expiry and installation binding stay unchanged.');
      if (row.updateAvailable === true) act('Offer updated packages', 'update-release', {}, `Offer the current verified packages and replace the private link? Preserve the existing installation, license, trial activation and expiry. This does not start another trial.`);
      act('Close trial access', 'close', {}, 'Close downloads and activation? An installed license needs the signed revocation installed on its server.');
    }
    if (row.state === 'closed' && row.installationId) act('Download revocation', 'revocation', undefined);
    act(row.archivedAt ? 'Restore to inbox' : 'Archive', row.archivedAt ? 'unarchive' : 'archive', {});
    $('requests').append(card);
  }
}
$('operator-login').addEventListener('submit', async event => {
  event.preventDefault(); token = $('operator-token').value.trim(); $('operator-token').value = '';
  try { await sessionAction('session'); token = ''; await refresh(); } catch (error) { token = ''; status(error.message); }
});
$('refresh').addEventListener('click', () => refresh().catch(error => status(error.message)));
$('request-view').addEventListener('change', () => { clearInvitation(); refresh().catch(error => status(error.message)); });
$('export').addEventListener('click', async () => {
  try {
    const response = await api(); const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a'); a.href = url; a.download = '127vaults-access-requests.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); status('Requests exported.');
  } catch (error) { status(error.message); }
});
$('logout').addEventListener('click', async () => { try { await sessionAction('logout'); } catch (error) { status(error.message); return; } closeMenu(); document.querySelectorAll('.request-menu-items').forEach(popup => popup.remove()); token = ''; clearInvitation(); $('requests').replaceChildren(); $('inbox').hidden = true; $('logout').hidden = true; $('operator-login').hidden = false; status('Signed out.'); });
$('hide-invite').addEventListener('click', clearInvitation);
$('copy-invite').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(`To: ${$('invite-to').value}\nSubject: ${$('invite-subject').value}\n\n${$('invite-message').value}`); status('Email message copied. Send it from your email client.'); }
  catch { $('invite-message').select(); status('Select and copy the message manually.'); }
});

async function sessionAction(action) {
  const response = await fetch(`/api/access-admin/${action}`, { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: '{}' });
  if (!response.ok) throw Error(action === 'session' ? 'Access key not accepted.' : 'Sign out failed. Refresh and try again.');
}
refresh().catch(() => status('Enter your operator key. Sessions last one hour.'));

$('review-releases').addEventListener('click', () => { location.assign('/trial?review=1'); });

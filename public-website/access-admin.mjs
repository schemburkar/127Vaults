const $ = id => document.getElementById(id);
let token = '';
let emailDryRun = false;
const status = message => { $('desk-status').textContent = message; };
async function api(path = '', value) {
  const response = await fetch(`/api/access-admin/requests${path}`, { method: value === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: value === undefined ? undefined : JSON.stringify(value), cache: 'no-store', credentials: 'omit' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (error.error === 'email_not_configured') throw Error('Cloudflare email is not configured. Copy the invitation and send it manually.');
    if (error.error === 'email_already_attempted') throw Error('Email was already attempted. Refresh its status. If needed, replace the private link before sending another invitation.');
    throw Error(error.error === 'access_required' ? 'Access key not accepted.' : error.error === 'state_changed'
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
  $('operator-login').hidden = true; $('inbox').hidden = false;
  $('logout').hidden = false;
  $('requests').replaceChildren();
  const view = $('request-view').value;
  const rows = data.requests.filter(row => view === 'all' || (view === 'archived' ? Boolean(row.archivedAt) : !row.archivedAt)).reverse();
  status(`${rows.length} request${rows.length === 1 ? '' : 's'}`);
  if (!rows.length) {
    const empty = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 8;
    cell.className = 'desk-empty'; cell.textContent = view === 'archived' ? 'No archived requests.' : 'No requests to show.';
    empty.append(cell); $('requests').append(empty);
  }
  for (const row of rows) {
    const card = document.createElement('tr');
    const cell = value => { const td = document.createElement('td'); td.textContent = value; card.append(td); return td; };
    const email = cell(row.email); email.className = 'request-email';
    cell(row.organization || '—'); cell(row.plan.charAt(0).toUpperCase() + row.plan.slice(1));
    const requested = cell(''); const time = document.createElement('time'); time.dateTime = row.receivedAt;
    time.textContent = new Date(row.receivedAt).toLocaleString(); requested.append(time);
    const usersCell = cell(row.maxUsers ?? '—');
    const state = cell(''); const badge = document.createElement('span'); badge.className = 'request-state';
    badge.textContent = row.state === 'rejected' ? 'Declined' : row.state === 'requested' ? 'Pending' : row.state.charAt(0).toUpperCase() + row.state.slice(1);
    state.append(badge);
    if (row.archivedAt) { const archived = document.createElement('small'); archived.textContent = 'Archived'; state.append(archived); }
    if (row.expiresAt) { const expiry = document.createElement('small'); expiry.textContent = `Expires ${new Date(row.expiresAt).toLocaleDateString()}`; state.append(expiry); }
    const emailStates = { not_sent: 'Not sent', accepted: 'Accepted', queued: 'Queued', bounced: 'Bounced', sending: 'Sending', unknown: 'Unconfirmed' };
    cell(row.state === 'approved' ? (emailDryRun && row.emailState !== 'not_sent' ? 'Simulated' : emailStates[row.emailState] || '—') : '—');
    const actionCell = cell(''), menu = document.createElement('details'); menu.className = 'request-menu';
    const menuLabel = document.createElement('summary'); menuLabel.textContent = 'Actions'; menuLabel.setAttribute('aria-label', `Actions for ${row.email}`);
    const menuItems = document.createElement('div'); menuItems.className = 'request-menu-items'; menu.append(menuLabel, menuItems); actionCell.append(menu);
    const act = (label, action, value, confirmation) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', async () => {
        if (confirmation && !confirm(confirmation)) return;
        menu.open = false;
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
          } else status(data.hasRevocation ? 'Link closed. Download the signed revocation and install it on the trial server to revoke its installed license.' : 'Request updated.');
        } catch (error) { status(error.message); }
        finally { button.disabled = false; }
      });
      menuItems.append(button);
    };
    if (row.state === 'requested') {
      const users = document.createElement('input'); users.type = 'number'; users.min = '1'; users.max = '100'; users.value = String(row.maxUsers ?? 5);
      users.className = 'request-users'; users.setAttribute('aria-label', `Maximum vault users for ${row.email}`); usersCell.replaceChildren(users);
      act('Approve', 'approve', () => ({ maxUsers: Number(users.value) }), `Approve a 10-day trial for ${row.email}?`);
      act('Decline', 'reject', {}, 'Decline this access request?');
    }
    if (row.state === 'approved') {
      if (row.canPreviewInvitation) act('Review invitation', 'invitation', undefined);
      if (row.canSendEmail) act(emailDryRun ? 'Send invitation (dry run)' : 'Send invitation', 'send-invitation', {}, emailDryRun ? `Simulate the invitation to ${row.email}? No real email will be sent.` : `Send the approved 10-day trial invitation to ${row.email} through Cloudflare?`);
      act('Replace private link', 'rotate', {}, 'Invalidate the old link and create a replacement? The trial expiry and installation binding stay unchanged.');
      act('Close trial access', 'close', {}, 'Close downloads and activation? An installed license needs the signed revocation installed on its server.');
    }
    if (row.state === 'closed' && row.installationId) act('Download revocation', 'revocation', undefined);
    act(row.archivedAt ? 'Restore to inbox' : 'Archive', row.archivedAt ? 'unarchive' : 'archive', {});
    $('requests').append(card);
  }
}
$('operator-login').addEventListener('submit', async event => {
  event.preventDefault(); token = $('operator-token').value.trim(); $('operator-token').value = '';
  try { await refresh(); } catch (error) { token = ''; status(error.message); }
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
$('logout').addEventListener('click', () => { token = ''; clearInvitation(); $('requests').replaceChildren(); $('inbox').hidden = true; $('logout').hidden = true; $('operator-login').hidden = false; status('Signed out.'); });
$('hide-invite').addEventListener('click', clearInvitation);
$('copy-invite').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(`To: ${$('invite-to').value}\nSubject: ${$('invite-subject').value}\n\n${$('invite-message').value}`); status('Email message copied. Send it from your email client.'); }
  catch { $('invite-message').select(); status('Select and copy the message manually.'); }
});

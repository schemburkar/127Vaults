const $ = id => document.getElementById(id);
let token = '';
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
  $('operator-login').hidden = true; $('inbox').hidden = false;
  $('release-revision').textContent = `Approved release source: ${data.sourceRevision}. ${data.emailEnabled ? 'Cloudflare email is configured. Invitations send only when you click Send invitation.' : 'Email sending is not configured. Copy invitations into your email client.'}`;
  $('requests').replaceChildren();
  const rows = data.requests.reverse();
  status(rows.length ? `${rows.length} access request${rows.length === 1 ? '' : 's'}.` : 'No requests yet. New submissions will appear here after refresh.');
  for (const row of rows) {
    const card = document.createElement('article'); card.className = 'access-card';
    const heading = document.createElement('h2'); heading.textContent = row.email;
    const detail = document.createElement('p'); detail.textContent = `${row.plan} · ${row.organization || 'Individual'} · ${new Date(row.receivedAt).toLocaleString()}`;
    const state = document.createElement('p'); state.textContent = `${row.state}${row.expiresAt ? ` · Trial expires ${new Date(row.expiresAt).toLocaleString()}` : ''}`;
    card.append(heading, detail, state);
    if (row.state === 'approved') {
      const email = document.createElement('p');
      const states = { not_sent: 'Invitation not sent by this site.', accepted: 'Invitation accepted by the recipient mail server.',
        queued: 'Cloudflare queued the invitation; inbox delivery is not yet confirmed.', bounced: 'The invitation bounced. Contact the requester separately.',
        sending: 'An email attempt is in progress or was interrupted. Refresh; replace the link before retrying.',
        unknown: 'Email delivery is unconfirmed. Check Cloudflare activity; replace the link before retrying.' };
      email.textContent = states[row.emailState] ?? 'Email status unavailable.'; card.append(email);
    }
    const act = (label, action, value, confirmation) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button'; button.textContent = label;
      button.addEventListener('click', async () => {
        if (confirmation && !confirm(confirmation)) return;
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
            status(data.emailState === 'accepted' ? 'Invitation accepted by the recipient mail server.'
              : data.emailState === 'queued' ? 'Cloudflare queued the invitation. This does not confirm inbox delivery.'
                : data.emailState === 'bounced' ? 'The invitation bounced. Contact the requester separately.'
                  : 'Sending was not confirmed. Check Cloudflare activity; replace the private link before another attempt.');
            return;
          }
          if (data.message && data.email) {
            clearInvitation(); $('invite-to').value = data.email; $('invite-subject').value = data.subject; $('invite-message').value = data.message;
            $('invitation').hidden = false; $('invite-message').focus();
            status('Review the invitation. Use Send invitation on the request card, or copy it into your email client.');
          } else status(data.hasRevocation ? 'Link closed. Download the signed revocation and install it on the trial server to revoke its installed license.' : 'Request updated.');
        } catch (error) { status(error.message); }
        finally { button.disabled = false; }
      });
      card.append(button);
    };
    if (row.state === 'requested') {
      const label = document.createElement('label'); label.className = 'access-field'; label.textContent = 'Maximum vault users';
      const users = document.createElement('input'); users.type = 'number'; users.min = '1'; users.max = '100'; users.value = '5'; label.append(users); card.append(label);
      act('Approve 10-day trial', 'approve', () => ({ maxUsers: Number(users.value) }), `Approve an unpaid self-hosted trial for ${row.email}? Cloud hosting is not included.`);
      act('Decline request', 'reject', {}, 'Decline this access request?');
    }
    if (row.state === 'approved') {
      if (row.canPreviewInvitation) act('Review invitation', 'invitation', undefined);
      if (row.canSendEmail) act('Send invitation', 'send-invitation', {}, `Send the approved 10-day trial invitation to ${row.email} through Cloudflare?`);
      act('Replace private link', 'rotate', {}, 'Invalidate the old link and create a replacement? The trial expiry and installation binding stay unchanged.');
      act('Close trial access', 'close', {}, 'Close downloads and activation? An installed license needs the signed revocation installed on its server.');
    }
    if (row.state === 'closed' && row.installationId) act('Download revocation', 'revocation', undefined);
    act('Erase contact request', 'erase', {}, 'Erase this contact request and close its link? Minimal license/revocation records are retained. Save any required revocation first.');
    $('requests').append(card);
  }
}
$('operator-login').addEventListener('submit', async event => {
  event.preventDefault(); token = $('operator-token').value.trim(); $('operator-token').value = '';
  try { await refresh(); } catch (error) { token = ''; status(error.message); }
});
$('refresh').addEventListener('click', () => refresh().catch(error => status(error.message)));
$('export').addEventListener('click', async () => {
  try {
    const response = await api(); const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a'); a.href = url; a.download = '127vaults-access-requests.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); status('Requests exported. Keep the contact export private and delete it when no longer needed.');
  } catch (error) { status(error.message); }
});
$('logout').addEventListener('click', () => { token = ''; clearInvitation(); $('requests').replaceChildren(); $('inbox').hidden = true; $('operator-login').hidden = false; status('Signed out.'); });
$('hide-invite').addEventListener('click', clearInvitation);
$('copy-invite').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(`To: ${$('invite-to').value}\nSubject: ${$('invite-subject').value}\n\n${$('invite-message').value}`); status('Email message copied. Send it from your email client.'); }
  catch { $('invite-message').select(); status('Select and copy the message manually.'); }
});

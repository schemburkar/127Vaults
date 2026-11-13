import { invitationStatus } from './invitation-status.mjs';
import { loadRequests, billingModeLabel } from './request-data.mjs';
import { adminFetch } from './admin-shell.mjs';
export function mountAccessDesk(root, { selected = null, embedded = false, onChange = async () => {} } = {}) {
const $ = id => root.querySelector('#' + id);
let selectedRequest = selected; let refreshSerial=0;

let emailDryRun = false;
let automaticCustomerEmail = false;
let actionPending = false;
const emailStates = { not_sent: 'Not sent', accepted: 'Submitted', queued: 'Queued — delivery not confirmed', bounced: 'Bounced', sending: 'Submitting', claimed: 'Submitting', unknown: 'Unconfirmed — review before resending', unconfirmed: 'Unconfirmed — review before resending', limited: 'Quota limit — manual delivery needed', expired: 'Expired — manual review needed', suppressed: 'Manual delivery only' };
const emailAction = action => ['approve', 'rotate', 'update-release', 'extend', 'replace-installation', 'close', 'reject', 'send-invitation', 'resend-invitation'].includes(action);
function emailEffect(action, row) {
  if (!emailAction(action) || row.kind === 'development') return 'No customer email will be sent by this action.';
  if (automaticCustomerEmail || (['send-invitation', 'resend-invitation'].includes(action) && !emailDryRun)) return `A customer email will be submitted to ${row.email}. Submission does not guarantee inbox delivery.`;
  return emailDryRun ? 'Only a local email simulation will be captured. No real email will be sent.' : 'Automatic customer email is off. You must share the customer message manually.';
}
async function confirmAction(label, action, row, input, details) {
  const dialog = $('confirm-action');
  $('confirm-title').textContent = label;
  $('confirm-recipient').textContent = `${row.contactName || row.email} · ${row.email} · ${row.organization || 'No organization'} · ${row.plan}`;
  $('confirm-details').textContent = [details || 'Update this request?', action === 'approve' ? `Approved vault user limit: ${input.maxUsers}. The trial starts at activation; no payment is created.` : '', action === 'extend' ? `Add ${input.days} days. The customer must install the updated license.` : ''].filter(Boolean).join(' ');
  $('confirm-email').textContent = emailEffect(action, row);
  $('confirm-check').checked = false; $('confirm-submit').disabled = true;
  dialog.returnValue = '';
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm' && $('confirm-check').checked), { once: true }); dialog.showModal(); });
}
$('confirm-check').addEventListener('change', () => { $('confirm-submit').disabled = !$('confirm-check').checked; });
$('confirm-action').querySelector('form').addEventListener('submit', event => {
  if (event.submitter?.value === 'confirm' && !$('confirm-check').checked) event.preventDefault();
});
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
  const response = await adminFetch(`/api/access-admin/requests${path}`, { method: value === undefined ? 'GET' : 'POST',
    headers: { ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: value === undefined ? undefined : JSON.stringify(value), cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401) { $('inbox').hidden = true; clearInvitation(); $('requests').replaceChildren(); }
    if (error.error === 'link_retention_limit') throw Error('The requested link expiry exceeds this request’s retention period. Choose fewer days.');
    if (error.error === 'email_not_configured') throw Error('Customer email is not configured. Copy the invitation and send it manually.');
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
  const serial=++refreshSerial,selection=selectedRequest;
  const data = await loadRequests(adminFetch);
  if(serial!==refreshSerial||selection!==selectedRequest)return;
  emailDryRun = data.emailDryRun === true;
  automaticCustomerEmail = data.automaticCustomerEmail === true;
  $('customer-email-status').textContent = automaticCustomerEmail
    ? 'Automatic customer email is on: request receipts, sign-in codes, approval invitations, link and license updates, declines and closures. Each change asks for confirmation. Queued means submitted, not delivered.'
    : 'Automatic customer email is off. Approval and license changes still take effect, but customer messages need manual delivery. Internal testing captures email locally.';
  const canApproveDevelopment=data.permissions?.approveDevelopment===true;
  $('request-alert-status').textContent = data.requestAlertsEnabled === true ? 'New-request email alerts are on.' : 'New-request email alerts are off.';
  $('inbox').hidden = false;
  closeMenu();
  root.querySelectorAll('.request-menu-items').forEach(popup => popup.remove());
  $('requests').replaceChildren();
  const view = $('request-view').value;
  const selected = selectedRequest;
  if (selected && !embedded) {
    const all = document.createElement('a'); all.href = '/access-admin'; all.textContent = 'Show all requests';
    $('customer-email-status').append(document.createTextNode(' '), all);
  }
  const rows = data.requests.filter(row => (!selected || row.id === selected)).filter(row => selected || view === 'all' || (view === 'archived' ? Boolean(row.archivedAt) : !row.archivedAt)).reverse();
  if (!embedded) status(`Operator access - ${rows.length} request${rows.length === 1 ? '' : 's'}`);
  if (!rows.length) {
    const empty = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 9;
    cell.className = 'desk-empty'; cell.textContent = view === 'archived' ? 'No archived requests.' : 'No requests to show.';
    empty.append(cell); $('requests').append(empty);
  }
  for (const row of rows) {
    const card = document.createElement('tr');
    let cellIndex = 0;
    const labels = ['Requester', 'Organization or message', 'Plan', 'Requested', 'Requested users', 'User limit', 'Status', 'Invitation', 'Actions'];
    const cell = value => { const td = document.createElement('td'); td.dataset.label = labels[cellIndex++]; td.textContent = value; card.append(td); return td; };
    const email = cell(row.email); email.className = 'request-email';
    if (row.contactName) { const name = document.createElement('small'); name.textContent = row.contactName; email.append(name); }
    if (row.requestAlertState) { const note = document.createElement('small'); note.textContent = ({ sending: 'Email alert pending', accepted: 'Email alert submitted', unconfirmed: 'Email alert unconfirmed' })[row.requestAlertState] || 'Email alert unconfirmed'; email.append(note); }
    cell(row.message ?? (row.organization || '—')); cell(row.plan.charAt(0).toUpperCase() + row.plan.slice(1));
    const requested = cell(''); const time = document.createElement('time'); time.dateTime = row.receivedAt;
    time.textContent = new Date(row.receivedAt).toLocaleString(); requested.append(time);
    cell(row.requestedSeats ?? '—');
    const usersCell = cell(row.maxUsers ?? '—');
    const state = cell(''); const badge = document.createElement('span'); badge.className = 'request-state';
    badge.textContent = row.state === 'rejected' ? 'Declined' : row.state === 'requested' ? 'Pending' : row.state.charAt(0).toUpperCase() + row.state.slice(1);
    state.append(badge);
    if (row.billingStatus) { const billing = document.createElement('small'); billing.textContent = `Subscription: ${row.billingStatus} · ${billingModeLabel(row)}`; state.append(billing); }
    email.title = `Request ID: ${row.id}`;
    if (row.archivedAt) { const archived = document.createElement('small'); archived.textContent = 'Archived'; state.append(archived); }
    if (row.replacementRequest) { const pending = document.createElement('small'); pending.textContent = `Replacement requested: ${row.replacementRequest.installationId}. ${row.replacementRequest.reason}`; state.append(pending); }
    if (row.expiresAt) { const expiry = document.createElement('small'); expiry.textContent = `Expires ${new Date(row.expiresAt).toLocaleDateString()}`; state.append(expiry); }
    const delivery = cell(row.state === 'approved' ? `Invitation: ${emailDryRun && row.emailState !== 'not_sent' ? 'Simulated' : emailStates[row.emailState] || '—'}` : '');
    for (const purpose of ['signup', 'access']) if (row.customerNotifications?.[purpose]) {
      const note = document.createElement('small'); note.textContent = `${purpose === 'signup' ? 'Request receipt' : 'Access notice'}: ${emailStates[row.customerNotifications[purpose]] || 'Unconfirmed'}`; delivery.append(note);
    }
    if (!delivery.textContent) delivery.textContent = '—';
    const actionCell = cell(''), menuLabel = document.createElement('button');
    menuLabel.type = 'button'; menuLabel.className = 'request-menu-trigger'; menuLabel.textContent = 'Actions';
    menuLabel.setAttribute('aria-label', `Actions for ${row.email}`); menuLabel.setAttribute('aria-haspopup', 'menu');
    menuLabel.setAttribute('aria-expanded', 'false'); menuLabel.setAttribute('aria-controls', `request-actions-${row.id}`);
    const menuItems = document.createElement('div'); menuItems.className = 'request-menu-items';
    menuItems.id = `request-actions-${row.id}`; menuItems.setAttribute('popover', 'auto'); menuItems.setAttribute('role', 'menu');
    menuItems.setAttribute('aria-label', `Actions for ${row.email}`);
    actionCell.append(menuLabel); (embedded ? root : document.body).append(menuItems);
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
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.action = action;
      button.setAttribute('role', 'menuitem'); button.tabIndex = -1;
      button.addEventListener('click', async () => {
        if (actionPending || (embedded && selectedRequest!==row.id)) return;
        actionPending = true;
        closeMenu();
        button.disabled = true;
        try {
          const input = typeof value === 'function' ? await value() : value;
          if (input === null) return;
          if (input !== undefined && !await confirmAction(label, action, row, input, confirmation)) return;
          const response = await api(`/${row.id}/${action}`, input);
          if (action === 'revocation') {
            const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a');
            a.href = url; a.download = 'trial-revocation.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            status('Install this revocation on the trial server to stop its licensed writes. Download access alone cannot revoke an offline server.'); return;
          }
          const data = await response.json();
          if(embedded&&selectedRequest!==row.id){await onChange();return;}
          await refresh();
          await onChange();
          if(embedded&&selectedRequest!==row.id)return;
          if (action === 'extend-link') {
            clearInvitation();
            root.querySelector('#request-actions-' + row.id + ' [data-action="invitation"]')?.click();
            return;
          }
          if (action === 'send-invitation') {
            if (emailDryRun) { status(`Dry-run email result: ${data.emailState}. Saved locally; no real email was sent.`); return; }
            status(data.emailState === 'accepted' ? 'Invitation accepted by the recipient mail server.'
              : data.emailState === 'queued' ? 'Email provider queued the invitation. This does not confirm inbox delivery.'
                : data.emailState === 'bounced' ? 'The invitation bounced. Contact the requester separately.'
                  : `Invitation: ${emailStates[data.emailState] || 'Unconfirmed'}. Review provider activity before any manual resend.`);
            return;
          }
          if (data.message && data.email) {
            clearInvitation(); $('invite-to').value = data.email; $('invite-subject').value = data.subject; $('invite-message').value = data.message;
            let context = $('invitation-context');
            if (!context) { context = document.createElement('div'); context.id = 'invitation-context'; $('invite-heading').after(context); }
            const previewRow = { ...row, ...data };
            const info = invitationStatus(previewRow);
            context.replaceChildren();
            for (const text of [info.label + ' — ' + info.detail, 'Link expiry: ' + (previewRow.linkExpiresAt ? new Date(previewRow.linkExpiresAt).toLocaleString() : 'Unavailable'), row.installationId ? 'Activated installation: ' + row.installationId : 'Not activated — the trial starts when a server is activated.', row.expiresAt ? 'License expiry: ' + new Date(row.expiresAt).toLocaleString() + '. Extending this link does not extend the license.' : 'Link expiry and trial duration are separate.']) {
              const line = document.createElement('p'); line.textContent = text; context.append(line);
            }
            const actions = document.createElement('div'); actions.className = 'invitation-actions';
            for (const original of (root.querySelector('#request-actions-' + row.id) ?? menuItems).querySelectorAll('[data-action="extend-link"], [data-action="send-invitation"], [data-action="resend-invitation"], [data-action="rotate"]')) {
              const shortcut = document.createElement('button'); shortcut.type = 'button'; shortcut.className = 'desk-button'; shortcut.textContent = original.textContent; shortcut.disabled = original.disabled; shortcut.addEventListener('click', () => original.click()); actions.append(shortcut);
            }
            if (!actions.querySelector('button') || !Array.from(actions.querySelectorAll('button')).some(button => /Send|Resend/.test(button.textContent))) {
              const unavailable = document.createElement('button'); unavailable.type = 'button'; unavailable.className = 'desk-button'; unavailable.disabled = true; unavailable.textContent = 'Send existing invitation'; actions.append(unavailable);
              const reason = document.createElement('p'); reason.textContent = !info.usable ? 'Sending is unavailable until the link is valid.' : ['sending','claimed','unknown','unconfirmed'].includes(previewRow.emailState) ? 'Review the previous delivery outcome before sending another copy. An uncertain attempt is not retried automatically.' : 'Email delivery is unavailable for this request. Check sender configuration, or copy the message for manual delivery.';
              context.append(reason);
            }
            context.append(actions);
            $('invitation').hidden = false; $('invite-heading').tabIndex = -1; $('invite-heading').focus();
            $('invitation-guidance').textContent = automaticCustomerEmail && row.kind !== 'development'
              ? 'The customer notification is automatic. Check its status in the request grid; copying this preview is optional and can cause a duplicate if sent manually.'
              : 'Automatic delivery is off. Use Send or Resend existing invitation when available, or copy the message for manual delivery.';
            status(action === 'invitation' ? 'Invitation preview opened. No email sent.' : `${label} completed. ${emailEffect(action, row)} Refresh to check the submission result.`);
          } else if (action === 'replace-installation') status('Replacement license issued. The customer can use the existing private link to download it. Review and send the replacement invitation if needed.');
          else status(`${label} completed. ${emailEffect(action, row)}${data.hasRevocation ? ' Download and apply the signed revocation on the trial server to revoke its installed license.' : ''}`);
        } catch (error) { if(!embedded||selectedRequest===row.id)status(error.message); }
        finally { button.disabled = false; actionPending = false; }
      });
      menuItems.append(button);
    };
    if (row.state === 'requested' && row.plan !== 'support') {
      const users = document.createElement('input'); users.type = 'number'; users.min = '1'; users.max = '100'; users.value = String(row.maxUsers ?? row.requestedSeats ?? 1);
      users.className = 'request-users'; users.setAttribute('aria-label', `Maximum vault users for ${row.email}`); usersCell.replaceChildren(users);
      if (['personal', 'commercial'].includes(row.plan)) act('Approve', 'approve', () => ({ maxUsers: Number(users.value) }), `Approve a 10-day trial for ${row.email}?`);
      if(canApproveDevelopment){
      const developmentLicense=document.createElement('input');developmentLicense.type='file';developmentLicense.accept='.json,application/json';
      developmentLicense.setAttribute('aria-label',`Existing signed development license for ${row.email}`);usersCell.append(developmentLicense);
      const developmentExpiry=document.createElement('input');developmentExpiry.type='date';developmentExpiry.setAttribute('aria-label','Development expiry for a new license; leave empty when attaching an existing signed license');usersCell.append(developmentExpiry);
      act('Approve development access','approve-development',async()=>{
        const file=developmentLicense.files?.[0];
        if(file){if(file.size>1600) throw Error('Choose the signed development license JSON, not a private issuer key.');return {license:await file.text()};}
        if(!developmentExpiry.value) throw Error('Choose a development expiry date or attach an existing signed development license.');
        return {maxUsers:Number(users.value),expiresAt:`${developmentExpiry.value}T23:59:59.000Z`};
      },'Create development download access for this signed license, preserving its installation identity, expiry and limits? Its operator contact is retained while development access is active.');
      }
      act('Decline', 'reject', {}, 'Decline this access request?');
    }
    if (row.state === 'approved') {
      if (!row.billingStatus && row.kind !== 'development' && row.installationId && !row.replacementRequest) act('Extend trial', 'extend', () => {
        const answer = prompt('Extra trial days for ' + row.email + ' (1-60). Added from the later of today or the current expiry. They must install the updated license.', '10');
        if (answer === null) return null;
        const days = Number(answer);
        if (!Number.isSafeInteger(days) || days < 1 || days > 60) throw Error('Enter a whole number from 1 to 60.');
        return { days, expectedExpiresAt: row.expiresAt };
      });
      if (row.replacementRequest) act('Issue replacement license', 'replace-installation', { installationId: row.replacementRequest.installationId, retired: true }, `Issue a replacement license for ${row.replacementRequest.installationId}? The customer confirmed the old installation is retired. Preserve the original expiry and limits. The signed old-license revocation must be applied on an old server if reachable.`);
      if ((row.replacementRequest || row.replacementCount)) act('Download old license revocation', 'revocation', undefined);
      if (row.canPreviewInvitation) act('Preview existing invitation', 'invitation', undefined);
      if (row.canPreviewInvitation) act('Extend link expiry (keep URL)', 'extend-link', () => {
        const answer = prompt('Extra days for this link (1–60). Keeps the same URL and does not extend the license or trial.', '30');
        if (answer === null) return null;
        const days = Number(answer); if (!Number.isSafeInteger(days) || days < 1 || days > 60) throw Error('Enter 1–60 whole days.');
        return { days, expectedLinkExpiresAt: row.linkExpiresAt };
      }, 'Extend the existing link from the later of now or its current expiry? The URL, installation binding, license and trial duration stay the same. No email is sent.');
      if (row.canResendEmail && invitationStatus(row).usable) act('Resend existing invitation', 'resend-invitation', { expectedEmailAttemptedAt: row.emailAttemptedAt ?? null }, 'Send the same link again? Its URL and expiry stay the same. The recipient may receive a duplicate.');
      if (row.canSendEmail && invitationStatus(row).usable) act(emailDryRun ? 'Send invitation (dry run)' : 'Send existing invitation', 'send-invitation', {}, `Submit the current invitation to ${row.email}? Previously attempted messages are protected against automatic duplicates.`);
      act('Replace link (invalidate old URL)', 'rotate', {}, 'Invalidate the old link and create a replacement? The trial expiry and installation binding stay unchanged.');
      if (row.updateAvailable === true) act('Update downloads and replace link', 'update-release', {}, `Offer the current verified packages and replace the private link? Preserve the existing installation, license, trial activation and expiry. The old URL stops working; the replacement offers updated downloads. This does not start another trial.`);
      if (!row.billingStatus) act('Close trial access', 'close', {}, 'Close downloads and activation? An installed license needs the signed revocation installed on its server.');
    }
    if (row.state === 'closed' && row.installationId) act('Download revocation', 'revocation', undefined);
    act(row.archivedAt ? 'Restore to inbox' : 'Archive', row.archivedAt ? 'unarchive' : 'archive', {});
    if (embedded) {
      const slot=root.closest('.workspace-drawer')?.querySelector('.drawer-actions');
      if(slot){slot.replaceChildren();const label=document.createElement('span');label.className='record-action-label';label.textContent='Record actions';slot.append(label);
        const preview=menuItems.querySelector('[data-action="approve"]')||menuItems.querySelector('[data-action="invitation"]');
        if(preview){const shortcut=document.createElement('button');shortcut.className='button primary';shortcut.type='button';shortcut.textContent=preview.dataset.action==='approve'?'Approve request':'Preview invitation';shortcut.addEventListener('click',()=>preview.click());slot.append(shortcut);}
        slot.append(menuLabel);actionCell.hidden=true;
      }
    }
    $('requests').append(card);
  }
}
$('refresh').addEventListener('click', () => refresh().catch(error => status(error.message)));
$('request-view').addEventListener('change', () => { if (!embedded) history.replaceState(null, '', location.pathname); clearInvitation(); refresh().catch(error => status(error.message)); });
$('export').addEventListener('click', async () => {
  try {
    const response = await api(); const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a'); a.href = url; a.download = '127vaults-access-requests.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); status('Requests exported.');
  } catch (error) { status(error.message); }
});
$('hide-invite').addEventListener('click', clearInvitation);
$('copy-invite').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(`To: ${$('invite-to').value}\nSubject: ${$('invite-subject').value}\n\n${$('invite-message').value}`); status('Email message copied. Send it from your email client.'); }
  catch { $('invite-message').select(); status('Select and copy the message manually.'); }
});

return { select: async id => { selectedRequest = id; closeMenu(); root.querySelectorAll('.request-menu-items').forEach(node=>node.remove()); $('requests').replaceChildren();root.closest('.workspace-drawer')?.querySelector('.drawer-actions')?.replaceChildren();status('Loading request…');clearInvitation();await refresh();if(selectedRequest===id)status(''); }, close: () => { refreshSerial++;selectedRequest=null;closeMenu(); clearInvitation(); } };

}

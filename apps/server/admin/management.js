import { escapeHtml } from './directory.js';
import { requestAdmin, errorMessage } from './api.js';

export function accountActions(kind, item, role) {
  if (kind === 'invitations') return item.status === 'pending' ? [{ action: 'invitation.revoke', label: 'Revoke invitation', detail: 'Unused recipients cannot enroll with this invitation. Enrolled accounts are retained.' }] : [];
  if (kind === 'devices') return item.status === 'active' ? [{ action: 'device.revoke', label: 'Revoke device', detail: 'This device loses online access and its online sessions end. Existing offline copies cannot be erased remotely.' }] : [];
  if (item.role === 'owner' && role !== 'owner' || item.status === 'pending') return [];
  const actions = [item.status === 'suspended'
    ? { action: 'account.reactivate', label: 'Reactivate account', detail: 'Online sign-in becomes available if a license seat is available. Old sessions remain invalid.' }
    : { action: 'account.suspend', label: 'Suspend account', detail: 'All online sessions end and future online sign-in is blocked. Encrypted vault data and devices are retained. At least one active owner must remain.' },
  { action: 'account.unlock', label: 'Clear authentication lock', detail: 'Clear failed-login delays and the authentication lock. This does not reset credentials or decrypt a vault.' }];
  if (role === 'owner') {
    actions.push({ action: 'role.set', role: item.role === 'user' ? 'admin' : 'user', label: item.role === 'user' ? 'Grant admin role' : 'Remove elevated role', detail: 'Change this account’s server role and end its online sessions. Vault access is unchanged. The console still uses its separate local operator file.' });
    if (item.role !== 'owner' && item.status === 'active') actions.push({ action: 'ownership.request', label: 'Request ownership acceptance', detail: 'The enrolled recipient must accept after a fresh unlock within 24 hours. You remain an owner until an explicit later role change.' });
  }
  return actions;
}

export function showManagementAction(root, session, descriptor, targetId, completed, trigger) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<dialog id="management-dialog" aria-labelledby="management-title"><form id="management-form"><div class="dialog-head"><h2 id="management-title">${escapeHtml(descriptor.label)}</h2><button class="button" type="button" id="management-close">Cancel</button></div><p>${escapeHtml(descriptor.detail)}</p>${descriptor.action === 'invitation.create' ? '<label class="field">Recipient emails, one per line<textarea id="management-emails" required maxlength="2600" rows="4"></textarea></label><label class="field">Expires<select id="management-expiry"><option value="24">24 hours</option><option value="48">48 hours</option></select></label>' : ''}<label class="field">Confirm your operator password<input id="management-password" type="password" autocomplete="current-password" required minlength="16" maxlength="256"></label><p id="management-status" role="status" aria-live="polite"></p><button class="button primary" id="management-submit" type="submit">${escapeHtml(descriptor.label)}</button><div id="management-result" hidden></div></form></dialog>`;
  const dialog = wrapper.firstElementChild;
  root.append(dialog);
  let pending = false, requestId = null, lastInput = null;
  const status = dialog.querySelector('#management-status');
  dialog.querySelector('#management-close').onclick = () => { if (!pending) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); trigger?.isConnected && trigger.focus(); }, { once: true });
  dialog.querySelector('#management-form').onsubmit = async event => {
    event.preventDefault(); if (pending) return;
    const fields = { action: descriptor.action, ...(targetId ? { targetId } : {}), ...(descriptor.role ? { role: descriptor.role } : {}) };
    if (descriptor.action === 'invitation.create') {
      fields.emails = dialog.querySelector('#management-emails').value.split(/[\n,;]/).map(value => value.trim()).filter(Boolean);
      fields.expiresInHours = Number(dialog.querySelector('#management-expiry').value);
    }
    const fingerprint = JSON.stringify(fields);
    if (lastInput !== fingerprint) { requestId = crypto.randomUUID(); lastInput = fingerprint; }
    const passwordInput = dialog.querySelector('#management-password'), password = passwordInput.value;
    passwordInput.value = '';
    pending = true; status.textContent = 'Confirming and applying this action…';
    dialog.querySelectorAll('button,input,textarea,select').forEach(element => { element.disabled = true; });
    try {
      const result = await requestAdmin('actions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-127v-admin-csrf': session.csrf }, body: JSON.stringify({ ...fields, requestId, password }) });
      if (!dialog.isConnected) return;
      if (result.token) {
        const output = dialog.querySelector('#management-result'); output.hidden = false;
        const note = document.createElement('p'); note.textContent = 'Invitation created. Share this code through your chosen trusted channel. It disappears when this dialog closes.';
        const code = document.createElement('textarea'); code.readOnly = true; code.value = result.token; code.setAttribute('aria-label', 'Invitation code');
        output.replaceChildren(note, code);
      }
      status.textContent = result.acceptanceRequired ? 'Ownership request created. The recipient must accept in their vault web app after a fresh unlock.' : 'Action completed. Refresh the directory to see the current state.';
      dialog.querySelector('#management-submit').hidden = true;
      dialog.querySelector('#management-password').parentElement.hidden = true;
      dialog.querySelector('#management-close').textContent = 'Close';
      completed();
    } catch (error) { if (dialog.isConnected) status.textContent = errorMessage(error) + ' Retry keeps the same request ID when the action is unchanged.'; }
    finally {
      pending = false;
      if (dialog.isConnected) dialog.querySelectorAll('button,input,textarea,select').forEach(element => { element.disabled = false; });
    }
  };
  dialog.showModal(); dialog.querySelector('#management-password').focus();
}

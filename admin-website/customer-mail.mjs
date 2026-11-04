import { adminReady, adminFetch } from './admin-shell.mjs';
const messages = document.getElementById('messages'), status = document.getElementById('mail-status');
let expiry;
async function refresh() {
  clearTimeout(expiry); messages.replaceChildren();
  const response = await adminFetch('/api/access-admin/customer-mail');
  if (!response.ok) throw Error('Messages could not be loaded.');
  const data = await response.json();
  status.textContent = data.messages.length ? 'Only unexpired, unused sign-in codes appear here.' : 'No pending sign-in messages.';
  for (const message of data.messages) {
    const card = document.createElement('article'); card.className = 'access-card';
    const heading = document.createElement('h2'); heading.textContent = message.to;
    const until = document.createElement('p'); until.textContent = `Expires: ${new Date(message.expiresAt).toLocaleString()}`;
    const content = `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`;
    const text = document.createElement('textarea'); text.readOnly = true; text.rows = 9; text.value = content; text.setAttribute('aria-label', `Email for ${message.to}`);
    const copy = document.createElement('button'); copy.className = 'button'; copy.textContent = 'Copy message';
    copy.addEventListener('click', async () => {
      if (Date.parse(message.expiresAt) <= Date.now()) { await refresh(); return; }
      try { await navigator.clipboard.writeText(content); status.textContent = 'Copied. Send it only to the displayed recipient.'; }
      catch { text.select(); status.textContent = 'Select and copy the message above.'; }
    });
    card.append(heading, until, text, copy); messages.append(card);
  }
  if (data.messages.length) expiry = setTimeout(() => refresh().catch(error => { messages.replaceChildren(); status.textContent = error.message; }), Math.max(0, Math.min(...data.messages.map(value => Date.parse(value.expiresAt))) - Date.now()) + 50);
}
document.getElementById('refresh').addEventListener('click', () => refresh().catch(error => { status.textContent = error.message; }));
adminReady.then(ready => { if (ready) return refresh(); }).catch(error => { status.textContent = error.message; });

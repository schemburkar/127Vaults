import { loadRequests, billingModeLabel } from './request-data.mjs';
import { adminReady, adminFetch } from './admin-shell.mjs';
const inbox = document.getElementById('inbox');
const drawer = document.createElement('dialog');
drawer.className = 'license-drawer'; drawer.setAttribute('aria-labelledby', 'license-drawer-title');
const header = document.createElement('header'); header.className = 'license-drawer-header';
const heading = document.createElement('h2'); heading.id = 'license-drawer-title';
const close = document.createElement('button'); close.type = 'button'; close.className = 'desk-button'; close.textContent = 'Close';
header.append(heading, close);
const details = document.createElement('div'); details.className = 'license-drawer-content';
drawer.append(header, details); document.body.append(drawer);
let desk, trigger, selectedId;
document.addEventListener('admin-session-ended', () => {
  if (drawer.open) drawer.close();
  desk?.close(); details.replaceChildren(); desk = null; trigger = null; selectedId = null;
  inbox.replaceChildren();
});
close.addEventListener('click', () => drawer.close());
drawer.addEventListener('close', () => { desk?.close(); trigger?.focus(); });
async function openRequest(row, button) {
  trigger = button; selectedId = row.id; heading.textContent = row.email + ' — Request details';
  if (!drawer.open) drawer.showModal();
  try {
    if (!desk) {
      details.textContent = 'Loading request…';
      const response = await adminFetch('/access-admin');
      if (!response.ok) throw Error('Request details could not be loaded. Close and try again.');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const main = page.querySelector('main'), confirmation = page.querySelector('#confirm-action');
      if (!main || !confirmation) throw Error('Request details are unavailable.');
      details.replaceChildren(...main.childNodes, confirmation);
      const { mountAccessDesk } = await import('./access-desk.mjs');
      desk = mountAccessDesk(details, { embedded: true, onChange: refresh });
    }
    await desk.select(row.id);
  } catch (error) { details.textContent = error.message; desk = null; }
}

async function refresh() {
  const data = await loadRequests(adminFetch);
  const rows = data.requests.filter(row => row.installationId);
  const summary = document.createElement('p'); summary.setAttribute('role', 'status');
  summary.textContent = `${rows.length} activated installation${rows.length === 1 ? '' : 's'}`;
  const wrap = document.createElement('div'); wrap.className = 'request-table-wrap'; wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Licenses');
  const table = document.createElement('table'); table.className = 'request-table';
  table.innerHTML = '<thead><tr><th scope="col">Customer</th><th scope="col">Plan</th><th scope="col">User limit</th><th scope="col">Installation</th><th scope="col">Expires</th><th scope="col">Status</th><th scope="col">Manage</th></tr></thead><tbody></tbody>';
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const text of [row.email, row.plan, row.maxUsers ?? '—', row.installationId || 'Not activated', row.expiresAt ? new Date(row.expiresAt).toLocaleString() : 'Not activated', row.billingStatus ? row.billingStatus + ' · ' + billingModeLabel(row) : row.state]) {
      const td = document.createElement('td'); td.textContent = text; tr.append(td);
    }
    const td = document.createElement('td'), link = document.createElement('button');
    if (selectedId === row.id) trigger = link;
    link.type = 'button'; link.className = 'desk-button'; link.textContent = 'View request'; link.addEventListener('click', () => openRequest(row, link)); td.append(link); tr.append(td); table.querySelector('tbody').append(tr);
  }
  if (!rows.length) { const tr = table.querySelector('tbody').insertRow(); const td = tr.insertCell(); td.colSpan = 7; td.textContent = 'No activated server licenses yet. Manage approvals and invitations in Access requests.'; }
  wrap.append(table); inbox.replaceChildren(summary, wrap);
}
adminReady.then(ready => { if (ready) return refresh(); }).catch(error => { inbox.textContent = error.message; });

import { adminReady, adminFetch } from './admin-shell.mjs';
const inbox = document.getElementById('inbox');
async function refresh() {
  const response = await adminFetch('/api/access-admin/requests');
  if (!response.ok) throw Error('Licenses could not be loaded. Refresh and try again.');
  const data = await response.json();
  const rows = data.requests.filter(row => row.installationId || row.state === 'approved');
  const summary = document.createElement('p'); summary.setAttribute('role', 'status');
  summary.textContent = `${rows.length} approved or installed license${rows.length === 1 ? '' : 's'}`;
  const wrap = document.createElement('div'); wrap.className = 'request-table-wrap'; wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Licenses');
  const table = document.createElement('table'); table.className = 'request-table';
  table.innerHTML = '<thead><tr><th scope="col">Customer</th><th scope="col">Plan</th><th scope="col">User limit</th><th scope="col">Installation</th><th scope="col">Expires</th><th scope="col">Status</th><th scope="col">Manage</th></tr></thead><tbody></tbody>';
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const text of [row.email, row.plan, row.maxUsers ?? '—', row.installationId || 'Not activated', row.expiresAt ? new Date(row.expiresAt).toLocaleString() : 'Not activated', row.billingStatus || row.state]) {
      const td = document.createElement('td'); td.textContent = text; tr.append(td);
    }
    const td = document.createElement('td'), link = document.createElement('a');
    link.href = `/access-admin?request=${encodeURIComponent(row.id)}`; link.textContent = 'View request'; td.append(link); tr.append(td); table.querySelector('tbody').append(tr);
  }
  if (!rows.length) { const tr = table.querySelector('tbody').insertRow(); const td = tr.insertCell(); td.colSpan = 7; td.textContent = 'No approved licenses yet.'; }
  wrap.append(table); inbox.replaceChildren(summary, wrap);
}
adminReady.then(ready => { if (ready) return refresh(); }).catch(error => { inbox.textContent = error.message; });

const root = document.querySelector('#app');
const state = { session: null, section: 'overview', overview: null, users: null, devices: null, error: '' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const date = value => value ? new Date(value).toLocaleString() : '—';
async function api(path, options = {}) {
  const response = await fetch(`/api/admin/${path}`, { credentials: 'same-origin', cache: 'no-store', ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
function badge(value) { const good = ['active', 'owner', 'online', 'current'].includes(String(value)); return `<span class="pill ${good ? 'good' : ''}">${escapeHtml(value)}</span>`; }
function login() {
  root.innerHTML = `<main class="login-wrap"><form class="login" id="login-form"><div class="brand"><span class="brand-mark">◇</span><span>127Vaults<small>Server administration</small></span></div><h1>Sign in to your server</h1><p class="muted">Use your local operator credentials. This session is separate from your vault.</p>${state.error ? `<p class="notice error" role="alert">${escapeHtml(state.error)}</p>` : ''}<label class="field">Operator name<input name="username" autocomplete="username" required autofocus></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label><button class="button primary" type="submit">Sign in</button><p class="footnote">Local administration · experimental server</p></form></main>`;
  document.querySelector('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button'); button.disabled = true;
    const fields = new FormData(event.currentTarget);
    try { state.session = await api('session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: fields.get('username'), password: fields.get('password') }) }); state.error = ''; await load(); }
    catch (error) { state.error = error.message === 'invalid_credentials' ? 'Check your operator name and password.' : error.message === 'rate_limited' ? 'Too many attempts. Try again shortly.' : error.message; login(); }
  });
}
function overview() {
  const o = state.overview;
  if (!o) return '<div class="notice error">Overview is unavailable.</div>';
  const backup = o.backup ?? { state: 'unknown' };
  return `<p class="muted">Local server health and account activity. Checked ${escapeHtml(date(o.checkedAt))}.</p><div class="grid"><div class="card"><span class="label">Server</span><span class="value">${escapeHtml(o.status)}</span>${badge(o.schemaVersion === o.expectedSchemaVersion ? 'online' : 'schema mismatch')}</div><div class="card"><span class="label">Accounts</span><span class="value">${escapeHtml(o.users?.users ?? '—')}</span><span class="detail">${escapeHtml(o.users?.active_users ?? '—')} active</span></div><div class="card"><span class="label">Active devices</span><span class="value">${escapeHtml(o.activeDevices)}</span><span class="detail">Across all accounts</span></div><div class="card"><span class="label">Backup</span><span class="value">${escapeHtml(backup.state)}</span><span class="detail">${escapeHtml(backup.detail ?? 'No recent status available')}</span></div></div><div class="columns"><section class="panel"><h2>Server details</h2><p class="muted">Database schema: <strong>${escapeHtml(o.schemaVersion)}</strong> · Expected: <strong>${escapeHtml(o.expectedSchemaVersion)}</strong></p><p class="muted">Health reflects the live API and database check. Backup status is reported separately.</p></section><section class="panel"><h2>Operator access</h2><p class="muted">Signed in as ${escapeHtml(state.session.username)} (${escapeHtml(state.session.role)}). Session expires ${escapeHtml(date(state.session.expiresAt))}. This admin session has no vault unlock state or vault keys.</p></section></div>`;
}
function users() {
  const data = state.users;
  if (!data) return '<div class="notice error">Users are unavailable.</div>';
  return `<p class="muted">Read-only account directory. Invitations and account actions are planned for a later step.</p><section class="panel"><div class="panel-head"><h2>Users <span class="pill">${data.users.length}</span></h2><span class="pill">Read only</span></div><div class="table-wrap"><table><thead><tr><th>Account</th><th>Server role</th><th>Status</th><th>Devices</th><th>Created</th></tr></thead><tbody>${data.users.map(user => `<tr><td><span class="name">${escapeHtml(user.displayName)}</span><span class="sub">${escapeHtml(user.username)} · ${escapeHtml(user.email)}</span></td><td>${badge(user.role)}</td><td>${badge(user.status)}</td><td>${escapeHtml(user.deviceCount)}</td><td>${escapeHtml(date(user.createdAt))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No users yet.</td></tr>'}</tbody></table></div>${data.limited ? '<p class="footnote">Showing the latest 100 users.</p>' : ''}</section>`;
}
function roles() {
  return `<p class="muted">Server roles are separate from vault membership and access.</p><div class="columns"><section class="panel"><h2>Owner</h2><p class="muted">Controls ownership, licensing, destructive server operations and root settings. Also has admin capabilities.</p><ul class="list"><li>Can initiate owner grants and transfers when implemented.</li><li>Cannot remove the last active owner.</li><li>Does not automatically receive vault keys or content access.</li></ul></section><section class="panel"><h2>Server admin</h2><p class="muted">Handles delegated control-plane operations such as users, invitations, authentication locks and routine settings.</p><ul class="list"><li>Cannot add, remove or demote owners.</li><li>Has no automatic access to private or shared vaults.</li><li>Exact write permissions will be finalized before controls are enabled.</li></ul></section></div><div class="notice">Role and ownership changes are not available in this first version. The current database still supports only one provisional vault-account owner.</div>`;
}
function devices() {
  const data = state.devices;
  if (!data) return '<div class="notice error">Devices are unavailable.</div>';
  return `<p class="muted">Device inventory across server accounts. Reporting or revocation will be added after review of permission and audit rules.</p><section class="panel"><div class="panel-head"><h2>Devices <span class="pill">${data.devices.length}</span></h2><span class="pill">Read only</span></div><div class="table-wrap"><table><thead><tr><th>Device ID</th><th>User</th><th>Status</th><th>Protection</th><th>Added</th></tr></thead><tbody>${data.devices.map(device => `<tr><td class="name">${escapeHtml(device.id.slice(0, 8))}…<span class="sub">${escapeHtml(device.credentialState)}</span></td><td>${escapeHtml(device.username)}</td><td>${badge(device.status)}</td><td>${escapeHtml(device.protection)}</td><td>${escapeHtml(date(device.createdAt))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No devices yet.</td></tr>'}</tbody></table></div>${data.limited ? '<p class="footnote">Showing the latest 100 devices.</p>' : ''}</section><div class="notice">Report a device: planned. No report is sent or recorded by this page yet.</div>`;
}
function backups() { const backup = state.overview?.backup ?? { state: 'unknown', detail: 'No status available.' }; return `<p class="muted">Backup visibility for this server.</p><section class="panel"><h2>Current backup status</h2><p>${badge(backup.state)}</p><p class="muted">${escapeHtml(backup.detail)}</p><p class="footnote">Backup creation and restore remain in the operator runbook. This page does not initiate either action.</p></section>`; }
function placeholder(name) { return `<section class="panel"><h2>${escapeHtml(name)} is coming later</h2><p class="muted">This area is reserved for a reviewed administration workflow.</p></section>`; }
const views = { overview, users, roles, devices, backups, settings: () => placeholder('Settings'), audit: () => placeholder('Audit') };
const titles = { overview: 'Overview', users: 'Users', roles: 'Roles & ownership', devices: 'Devices', backups: 'Backups', settings: 'Settings', audit: 'Audit' };
function render() {
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">◇</span><span>127Vaults<small>Server administration</small></span></div><nav class="nav" aria-label="Admin sections">${Object.entries(titles).map(([key, label]) => `<button type="button" data-section="${key}" class="${state.section === key ? 'active' : ''}" ${state.section === key ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav><div class="sidebar-foot">Local operator console<br>Experimental server</div></aside><main class="main"><header class="top"><div><p class="eyebrow">Control plane</p><h1>${titles[state.section]}</h1></div><div class="top-actions"><span class="operator">${escapeHtml(state.session.username)} · ${escapeHtml(state.session.role)}</span><button class="button" id="signout">Sign out</button></div></header>${state.error ? `<p class="notice error" role="alert">${escapeHtml(state.error)}</p>` : ''}${views[state.section]()}</main></div>`;
  document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => { state.section = button.dataset.section; render(); }));
  document.querySelector('#signout').addEventListener('click', async () => { try { await api('session', { method: 'DELETE', headers: { 'X-127v-admin-csrf': state.session.csrf } }); } finally { state.session = null; state.error = ''; login(); } });
}
async function load() {
  const results = await Promise.allSettled([api('overview'), api('users'), api('devices')]);
  [state.overview, state.users, state.devices] = results.map(result => result.status === 'fulfilled' ? result.value : null);
  state.error = results.some(result => result.status === 'rejected') ? 'Some server data is unavailable. Try refreshing the page.' : '';
  render();
}
try { state.session = await api('session'); await load(); } catch { login(); }

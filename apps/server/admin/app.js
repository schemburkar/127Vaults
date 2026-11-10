import { escapeHtml, date, badge, newDirectory, directoryQuery, directoryView, detailsView, reviewQueue } from './directory.js';
import { requestAdmin as api, errorMessage as message } from './api.js';
import { accountActions, showManagementAction } from './management.js';
import { seatSummary } from './seat-summary.mjs';

const root = document.querySelector('#app');
const titles = { overview: 'Overview', users: 'Users', invitations: 'Invitations', roles: 'Roles & ownership', devices: 'Devices', backups: 'Backups', settings: 'Settings', audit: 'Audit' };
const overviewSections = new Set(['overview', 'backups', 'settings']);
const resource = () => ({ data: null, loading: false, error: '', checkedAt: null, request: 0, controller: null });
const state = { session: null, section: sectionFromHash(), overview: resource(), users: newDirectory(), devices: newDirectory(), invitations: newDirectory(), audit: resource(), ownership: resource(), error: '', loginName: '', retryUntil: 0, signingOut: false, generation: 0 };
let sessionTimer;
let loginTimer;

function sectionFromHash() { return Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : 'overview'; }
function cancelRequests() {
  for (const key of ['overview', 'users', 'devices', 'invitations', 'audit', 'ownership']) {
    state[key].controller?.abort();
    state[key].loading = false;
    state[key].request += 1;
  }
}
function clearSession(error = '') {
  state.generation += 1;
  cancelRequests();
  clearInterval(sessionTimer);
  state.loginName = state.session?.username ?? state.loginName;
  state.session = null;
  state.overview = resource(); state.users = newDirectory(); state.devices = newDirectory();
  state.invitations = newDirectory(); state.audit = resource(); state.ownership = resource();
  state.error = error;
  state.signingOut = false;
  login();
}
function setSession(session) {
  clearInterval(loginTimer);
  state.retryUntil = 0;
  state.session = session;
  state.section = sectionFromHash();
  state.generation += 1;
  state.error = '';
  clearInterval(sessionTimer);
  sessionTimer = setInterval(updateSessionStatus, 15_000);
  render();
  updateSessionStatus();
  void loadSection();
}
function sessionStatus() {
  if (!state.session) return '';
  const remaining = new Date(state.session.expiresAt).getTime() - Date.now();
  if (remaining <= 0) return 'Session expired';
  const minutes = Math.ceil(remaining / 60_000);
  return `Session expires in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}
function updateSessionStatus() {
  if (!state.session) return;
  if (new Date(state.session.expiresAt).getTime() <= Date.now()) {
    clearSession('Your operator session expired. Sign in again to continue.');
    return;
  }
  const element = document.querySelector('#session-status');
  if (element) {
    const text = sessionStatus();
    if (element.textContent !== text) element.textContent = text;
    element.classList.toggle('session-warning', new Date(state.session.expiresAt).getTime() - Date.now() <= 5 * 60_000);
  }
}
function login() {
  clearInterval(loginTimer);
  root.innerHTML = `<main class="login-wrap"><form class="login" id="login-form"><div class="brand"><img src="/brand-mark.svg" width="35" height="35" alt=""><span><img src="/wordmark.svg" width="127" height="40" alt="127 Vaults"><small>Server administration</small></span></div><h1>Sign in to your server</h1><p class="server-origin">${escapeHtml(location.host)}</p><p class="muted">Use your local operator credentials. This session is separate from your vault.</p>${state.error ? `<p class="notice error" role="alert">${escapeHtml(state.error)}</p>` : ''}<label class="field">Operator name<input name="username" autocomplete="username" required value="${escapeHtml(state.loginName)}"></label><label class="field">Password<div class="password-control"><input name="password" aria-label="Password" type="password" autocomplete="current-password" required><button class="button" type="button" id="show-password" aria-label="Show password" aria-pressed="false">Show</button></div></label><p id="caps-lock" class="footnote session-warning" role="status" hidden>Caps Lock is on.</p><button class="button primary" type="submit" id="login-submit">Sign in</button><p id="login-wait" class="footnote" role="status"></p><p class="footnote">Local administration · experimental server<br>Sessions expire after 30 minutes.</p></form></main>`;
  const form = document.querySelector('#login-form');
  const password = form.elements.password;
  const showPassword = document.querySelector('#show-password');
  showPassword.addEventListener('click', () => {
    const show = password.type === 'password'; password.type = show ? 'text' : 'password';
    showPassword.textContent = show ? 'Hide' : 'Show'; showPassword.setAttribute('aria-pressed', String(show));
    showPassword.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  for (const event of ['keydown', 'keyup']) password.addEventListener(event, event => { document.querySelector('#caps-lock').hidden = !event.getModifierState('CapsLock'); });
  const updateWait = () => {
    const seconds = Math.max(0, Math.ceil((state.retryUntil - Date.now()) / 1000));
    const button = document.querySelector('#login-submit');
    if (!button) { clearInterval(loginTimer); return; }
    button.disabled = seconds > 0;
    button.textContent = seconds ? `Try again in ${seconds}s` : 'Sign in';
    document.querySelector('#login-wait').textContent = seconds ? 'The server requires a short wait before another sign-in attempt.' : '';
    if (!seconds) clearInterval(loginTimer);
  };
  updateWait();
  if (state.retryUntil > Date.now()) loginTimer = setInterval(updateWait, 1000);
  form.elements[state.loginName ? 'password' : 'username'].focus();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    const fields = new FormData(form);
    form.querySelectorAll('input,button').forEach(element => { element.disabled = true; });
    button.textContent = 'Signing in…';
    state.loginName = String(fields.get('username'));
    try {
      const session = await api('session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: state.loginName, password: fields.get('password') }) });
      form.reset();
      setSession(session);
    } catch (error) { state.error = message(error); state.retryUntil = Date.now() + (error.retryAfter || 0) * 1000; login(); }
  });
}
function overview() {
  const o = state.overview.data;
  if (!o) return state.overview.loading ? '<section class="panel empty-state" role="status"><h2>Checking your server…</h2><p>Loading API, database and account status.</p></section>' : '<section class="panel empty-state"><h2>Server status is unavailable</h2><p>Retry the check to see current health.</p></section>';
  const backup = o.backup ?? { state: 'unknown' };
  const mismatch = o.schemaVersion !== o.expectedSchemaVersion;
  return `<p class="muted">Local server health and account activity. Checked ${escapeHtml(date(o.checkedAt))}.</p>${mismatch ? '<div class="notice error" role="alert"><strong>Database schema needs attention.</strong><p>The installed schema differs from the expected version. Follow the migration runbook before using the server.</p></div>' : ''}<div class="grid"><div class="card"><span class="label">API & database</span><span class="value">${escapeHtml(o.status)}</span>${badge(mismatch ? 'schema mismatch' : 'online')}</div><div class="card"><span class="label">Accounts</span><span class="value">${escapeHtml(o.users?.users ?? '—')}</span><span class="detail">${escapeHtml(o.users?.active_users ?? '—')} active</span><button class="text-button card-link" data-inspect="users" type="button">View accounts →</button></div><div class="card"><span class="label">Active devices</span><span class="value">${escapeHtml(o.activeDevices)}</span><span class="detail">Across all accounts</span><button class="text-button card-link" data-inspect="devices" type="button">View devices →</button></div><div class="card"><span class="label">Backup</span><span class="value">${escapeHtml(backup.state)}</span><span class="detail">${escapeHtml(backup.detail ?? 'No recent status available')}</span><button class="text-button card-link" data-section="backups" type="button">Review backup status →</button></div></div>${reviewQueue(o)}${licenseSummary(o.license)}<div class="columns"><section class="panel"><h2>Server details</h2><dl class="details-list"><div><dt>Server address</dt><dd>${escapeHtml(location.host)}</dd></div><div><dt>Installed schema</dt><dd>${escapeHtml(o.schemaVersion)}</dd></div><div><dt>Expected schema</dt><dd>${escapeHtml(o.expectedSchemaVersion)}</dd></div></dl><p class="muted">Health reflects the live API and database check. Unknown backup status does not confirm a recent backup.</p></section><section class="panel"><h2>Operator access</h2><p class="muted">Signed in as ${escapeHtml(state.session.username)} (${escapeHtml(state.session.role)}). Session expires ${escapeHtml(date(state.session.expiresAt))}.</p><p class="muted">This admin session has no vault unlock state or vault keys.</p></section></div>`;
}
function licenseSummary(license) {
  const details = license ? `<p>${escapeHtml(license.plan ?? 'License')} · ${escapeHtml(license.mode)}</p>
    <p>${escapeHtml(seatSummary(license))}</p>
    ${license.expiresAt ? `<p>License expires ${escapeHtml(date(license.expiresAt))}.</p>` : ''}
    ${license.mode === 'read-only' && license.readOnlyUntil ? `<p>Read-only access ends ${escapeHtml(date(license.readOnlyUntil))}.</p>` : ''}` : '<p>License details are unavailable.</p>';
  return `<section class="panel"><h2>Installed license and seats</h2>${details}
    <a href="https://manage.127vaults.com/" rel="noreferrer">Manage subscription</a></section>`;
}
function roles() {
  if (state.session.managementEnabled) return '<p class="muted">Server account roles do not grant vault keys. This console uses separately configured local operators.</p><section class="panel"><h2>Manage roles</h2><p>Open an account’s details under Users to grant or remove an admin role, request ownership acceptance, or remove an owner role. Owners can manage elevated roles; admins cannot change or suspend owners.</p><p>Every action requires your current operator password. At least one active owner must remain. Recipients accept ownership in their vault web app after a fresh unlock.</p><p>License installation, destructive server operations and secret settings remain in the operator runbooks.</p></section>';
  return `<p class="muted">Server roles are separate from vault membership and access.</p><div class="columns"><section class="panel"><h2>Owner</h2><p class="muted">Controls ownership, licensing, destructive server operations and root settings. Also has admin capabilities.</p><ul class="list"><li>Can initiate owner grants and transfers when implemented.</li><li>Cannot remove the last active owner.</li><li>Does not automatically receive vault keys or content access.</li></ul></section><section class="panel"><h2>Server admin</h2><p class="muted">Handles delegated control-plane operations such as users, invitations, authentication locks and routine settings.</p><ul class="list"><li>Cannot add, remove or demote owners.</li><li>Has no automatic access to private or shared vaults.</li><li>Exact write permissions will be finalized before controls are enabled.</li></ul></section></div><div class="notice">Role and ownership changes are not available in this version. The current database supports one provisional vault-account owner. Operator roles apply to this separate read-only console.</div>`;
}
function backups() {
  if (!state.overview.data) return overview();
  const backup = state.overview.data.backup ?? { state: 'unknown', detail: 'No status available.' };
  return `<p class="muted">Backup visibility for this server. Checked ${escapeHtml(date(state.overview.data.checkedAt))}.</p><section class="panel"><h2>Current backup status</h2><p>${badge(backup.state)}</p><p class="muted">${escapeHtml(backup.detail)}</p>
    <dl class="details-list">
      <div><dt>Last verified database backup</dt><dd>${escapeHtml(backup.lastBackupAt ? date(backup.lastBackupAt) : 'No record')}</dd></div>
      <div><dt>Last database restore rehearsal</dt><dd>${escapeHtml(backup.lastRestoreCheckAt ? date(backup.lastRestoreCheckAt) : 'No record')}</dd></div>
    </dl>
    <p class="footnote">Use the operator runbook to back up the database and server identity, store the recovery key separately, and rehearse a restore. These dates report completed database operations for this installation.</p></section>`;
}
function placeholder(name) { return `<section class="panel empty-state"><h2>${escapeHtml(name)} is coming later</h2><p>This area is reserved for a reviewed administration workflow.</p></section>`; }
function settings() {
  const configuration = state.overview.data?.configuration;
  if (!state.overview.data) return overview();
  if (!configuration) return '<section class="panel"><h2>Server configuration is unavailable</h2><p>Refresh after checking the server version.</p></section>';
  const configured = value => value ? 'Configured' : 'Not configured';
  return `<section class="panel"><h2>Server configuration</h2><dl class="details-list">
    <div><dt>Operator accounts</dt><dd>${escapeHtml(configuration.operatorCount)}</dd></div>
    <div><dt>HTTPS certificate expires</dt><dd>${escapeHtml(date(configuration.tlsExpiresAt))}</dd></div>
    <div><dt>Enrollment email (SMTP)</dt><dd>${configured(configuration.smtpConfigured)}</dd></div>
    <div><dt>Subscription refresh</dt><dd>${configured(configuration.subscriptionRefreshConfigured)}</dd></div>
    </dl><p>Enrollment uses email verification. Check your server’s SMTP configuration if recipients cannot finish enrollment.</p>
    <p class="muted">Edit deployment settings and operator credentials from the server host. Apply changes using the installation runbook.</p></section>${licenseSummary(state.overview.data.license)}`;
}
const views = { overview, users: () => directoryView('users', state.users), invitations: () => directoryView('invitations', state.invitations), roles: () => roles() + ownershipView(), devices: () => directoryView('devices', state.devices), backups, settings, audit: auditView };
function currentResource() { return overviewSections.has(state.section) ? state.overview : ['users', 'devices', 'invitations'].includes(state.section) ? state[state.section] : state.session.managementEnabled && state.section === 'audit' ? state.audit : state.session.managementEnabled && state.session.role === 'owner' && state.section === 'roles' ? state.ownership : null; }
function auditView() {
  if (!state.session.managementEnabled) return placeholder('Audit');
  const events = state.audit.data?.events || [];
  const outcome = state.audit.outcome || '';
  const filters = `<form id="audit-filters" class="filters">
    <div class="field"><label for="audit-outcome">Outcome</label><select name="outcome" id="audit-outcome">
      <option value="">All outcomes</option>
      <option value="accepted" ${outcome === 'accepted' ? 'selected' : ''}>Accepted</option>
      <option value="denied" ${outcome === 'denied' ? 'selected' : ''}>Denied</option>
    </select></div><button class="button" type="submit">Apply filter</button>
    <button id="audit-export" class="button" type="button" ${state.audit.loading || !events.length ? 'disabled' : ''}>Download redacted JSON</button>
  </form>`;
  return `<section class="panel"><h2>Recent management actions</h2><p class="muted">Up to 100 actions matching the selected outcome. The redacted download contains action, outcome and time for those events.</p>${filters}<div class="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Outcome</th><th>Target ID</th></tr></thead><tbody>${events.map(event => `<tr><td>${escapeHtml(date(event.createdAt))}</td><td>${escapeHtml(event.actor)}</td><td>${escapeHtml(event.action)}</td><td>${escapeHtml(event.outcome)}</td><td class="mono">${escapeHtml(event.targetId || 'Installation')}</td></tr>`).join('')}</tbody></table></div>${!events.length ? '<p>No matching actions loaded.</p>' : ''}</section>`;
}
function ownershipView() {
  if (!state.session.managementEnabled || state.session.role !== 'owner') return '';
  const grants = state.ownership.data?.grants || [];
  return `<section class="panel"><h2>Pending ownership requests</h2><p class="muted">Recipients accept in their vault web app after a fresh unlock. Requests expire after 24 hours.</p>${grants.map((grant, index) => `<div class="refresh-bar"><p>${escapeHtml(grant.username)} · expires ${escapeHtml(date(grant.expiresAt))}</p><button class="button" data-cancel-grant="${index}" type="button">Cancel request</button></div>`).join('')}${!grants.length ? '<p>No pending ownership requests loaded.</p>' : ''}</section>`;
}
function render({ focus = '' } = {}) {
  if (!state.session) return;
  const active = document.activeElement;
  const previousFocus = active?.id || '';
  const navFocus = active?.dataset.section;
  const data = currentResource();
  const directory = ['users', 'devices', 'invitations'].includes(state.section);
  root.innerHTML = `<a class="skip-link" href="#main-content">Skip to content</a><div class="shell"><aside class="sidebar"><div class="brand"><img src="/brand-mark.svg" width="35" height="35" alt=""><span><img src="/wordmark.svg" width="127" height="40" alt="127 Vaults"><small>Server administration</small></span></div><nav class="nav" aria-label="Admin sections">${Object.entries(titles).map(([key, text]) => `<button type="button" data-section="${key}" class="${state.section === key ? 'active' : ''}" ${state.section === key ? 'aria-current="page"' : ''}>${text}</button>`).join('')}</nav><div class="sidebar-foot"><span class="server-origin">${escapeHtml(location.host)}</span><br>Local operator console<br>Experimental server</div></aside><main class="main" id="main-content" tabindex="-1"><header class="top"><div><p class="eyebrow">Control plane</p><h1 id="page-title" tabindex="-1">${titles[state.section]}</h1></div><div class="top-actions"><div><span class="operator">${escapeHtml(state.session.username)} · ${escapeHtml(state.session.role)}</span><span id="session-status" class="sub" role="status">${escapeHtml(sessionStatus())}</span></div><button class="button" id="signout" ${state.signingOut ? 'disabled' : ''}>${state.signingOut ? 'Signing out…' : 'Sign out'}</button></div></header>${state.error ? `<p class="notice error" role="alert">${escapeHtml(state.error)}</p>` : ''}${data ? `<div class="refresh-bar"><p class="muted" role="status">${data.loading ? 'Refreshing server data…' : data.checkedAt ? 'Last loaded ' + escapeHtml(date(data.checkedAt)) : 'Ready to check server data'}</p><button class="button" id="refresh-data" type="button" ${data.loading ? 'disabled' : ''}>${data.loading ? 'Refreshing…' : 'Refresh'}</button></div>` : ''}${!directory && data?.error ? `<div class="notice error" role="alert"><p>${escapeHtml(data.error)}</p>${data.data ? '<p>Showing the last loaded data. Current server health is unconfirmed.</p>' : ''}<button class="button" id="retry-data" type="button">Try again</button></div>` : ''}${views[state.section]()}</main></div>`;
  document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.section)));
  document.querySelectorAll('[data-inspect]').forEach(button => button.addEventListener('click', () => {
    const filters = {};
    for (const key of ['status', 'credential', 'protection', 'signIn']) if (button.dataset[key]) filters[key] = button.dataset[key];
    inspectDirectory(button.dataset.inspect, filters);
  }));
  document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); document.querySelector('#main-content').focus(); });
  document.querySelector('#signout').addEventListener('click', signOut);
  document.querySelector('#refresh-data')?.addEventListener('click', () => loadSection(true, 'refresh-data'));
  document.querySelector('#retry-data')?.addEventListener('click', () => loadSection(true, 'refresh-data'));
  if (directory) bindDirectory(state.section);
  document.querySelector('#audit-filters')?.addEventListener('submit', event => {
    event.preventDefault();
    state.audit.outcome = new FormData(event.currentTarget).get('outcome');
    state.audit.data = null;
    state.audit.checkedAt = null;
    void loadSection(true, 'audit-outcome');
  });
  document.querySelector('#audit-export')?.addEventListener('click', () => {
    const events = state.audit.data.events.map(({ action, outcome, createdAt }) => ({ action, outcome, createdAt }));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ events }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '127vaults-admin-audit.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  if (state.session.managementEnabled && state.section === 'invitations') {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button primary'; button.textContent = 'Create invitation';
    button.onclick = () => showManagementAction(root, state.session, { action: 'invitation.create', label: 'Create invitation', detail: 'Reserve seats for up to ten email addresses. Share the resulting code through your chosen trusted channel. Recipients must verify their email during enrollment.' }, null, () => { state.invitations.data = null; }, button);
    document.querySelector('#page-title').parentElement.append(button);
  }
  document.querySelectorAll('[data-cancel-grant]').forEach(button => {
    const grant = state.ownership.data.grants[Number(button.dataset.cancelGrant)];
    button.onclick = () => showManagementAction(root, state.session, { action: 'ownership.cancel', label: 'Cancel ownership request', detail: 'The recipient can no longer accept this request. Existing ownership is unchanged.' }, grant.grantId, () => { state.ownership.data = null; }, button);
  });
  updateSessionStatus();
  const target = focus || previousFocus;
  const element = target ? document.getElementById(target) : navFocus ? document.querySelector(`.nav [data-section="${navFocus}"]`) : null;
  if (element && !element.disabled) element.focus({ preventScroll: !focus });
}
function navigate(section) {
  if (!Object.hasOwn(titles, section) || !state.session) return;
  state.section = section;
  if (location.hash !== `#${section}`) history.replaceState(null, '', `#${section}`);
  render({ focus: 'page-title' });
  void loadSection();
}
window.addEventListener('hashchange', () => navigate(sectionFromHash()));
async function loadSection(force = false, focus = '') {
  const section = state.section;
  const key = overviewSections.has(section) ? 'overview' : section === 'roles' ? 'ownership' : section;
  if (['ownership','audit'].includes(key) && (!state.session?.managementEnabled || key === 'ownership' && state.session.role !== 'owner')) return;
  if (!['overview', 'users', 'devices', 'invitations', 'audit', 'ownership'].includes(key) || !state.session) return;
  const entry = state[key];
  if (!force && (entry.data || entry.loading)) return;
  entry.controller?.abort();
  const controller = new AbortController();
  entry.controller = controller;
  const request = ++entry.request;
  const generation = state.generation;
  entry.loading = true; entry.error = '';
  render({ focus: focus === 'directory-search' ? '' : focus });
  try {
    const query = ['users', 'devices', 'invitations'].includes(key) ? directoryQuery(key, entry)
      : key === 'audit' && entry.outcome ? new URLSearchParams({ outcome: entry.outcome }) : '';
    const data = await api(key + (query ? '?' + query : ''), { signal: controller.signal });
    if (entry.request !== request || state.generation !== generation) return;
    entry.data = data; entry.checkedAt = new Date().toISOString();
    if (['users','devices','invitations'].includes(key)) entry.page = data.page;
  } catch (error) {
    if (controller.signal.aborted || entry.request !== request || state.generation !== generation) return;
    if (error.status === 401) { clearSession('Your operator session expired or the server restarted. Sign in again to continue.'); return; }
    entry.error = message(error);
  } finally {
    if (entry.request === request && state.generation === generation) {
      entry.loading = false; entry.controller = null;
      if ((state.section === key || key === 'overview' && overviewSections.has(state.section) || key === 'ownership' && state.section === 'roles') && state.session) render({ focus });
    }
  }
}
function bindDirectory(kind) {
  const entry = state[kind];
  const form = document.querySelector('#directory-filters');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const fields = new FormData(form);
    const q = String(fields.get('q') ?? '').trim();
    const status = String(fields.get('status') ?? '');
    const filter = kind === 'users' ? 'role' : kind === 'devices' ? 'protection' : null;
    entry.filters = { ...entry.filters, q, status, sort: String(fields.get('sort') ?? 'newest'), ...(kind === 'devices' ? { credential: String(fields.get('credential') ?? '') } : {}), ...(filter ? { [filter]: String(fields.get(filter) ?? '') } : {}) };
    if (kind === 'users') entry.filters.signIn = String(fields.get('signIn') ?? '');
    entry.page = 1; entry.data = null;
    void loadSection(true, 'directory-search');
  });
  document.querySelector('#clear-filters').addEventListener('click', () => {
    entry.filters = { ...newDirectory().filters, pageSize: entry.filters.pageSize, sort: entry.filters.sort };
    entry.accountName = ''; entry.page = 1; entry.data = null;
    void loadSection(true, 'directory-search');
  });
  document.querySelector('#clear-account')?.addEventListener('click', () => {
    entry.filters.accountId = ''; entry.accountName = ''; entry.page = 1; entry.data = null;
    void loadSection(true, 'directory-search');
  });
  document.querySelector('#page-size').addEventListener('change', event => {
    entry.filters.pageSize = Number(event.target.value); entry.page = 1; entry.data = null;
    void loadSection(true, 'page-size');
  });
  const changePage = page => { entry.page = page; entry.data = null; void loadSection(true, 'directory-summary'); };
  document.querySelectorAll('[data-page-change]').forEach(button => button.addEventListener('click', () => changePage(entry.data.page + Number(button.dataset.pageChange))));
  document.querySelector('#page-jump')?.addEventListener('submit', event => { event.preventDefault(); changePage(Number(new FormData(event.currentTarget).get('page'))); });
  document.querySelectorAll('[data-details]').forEach(button => button.addEventListener('click', () => showDetails(kind, entry.data[kind][Number(button.dataset.details)], button)));
  document.querySelectorAll('[data-account]').forEach(button => button.addEventListener('click', () => accountDevices(entry.data.users[Number(button.dataset.account)])));
}
function accountDevices(account) {
  state.devices.request += 1;
  state.devices.controller?.abort();
  state.devices = newDirectory();
  state.devices.filters.accountId = account.id;
  state.devices.accountName = account.displayName || account.username;
  navigate('devices');
}
function inspectDirectory(kind, filters = {}) {
  if (!['users', 'devices', 'invitations'].includes(kind)) return;
  state[kind].request += 1;
  state[kind].controller?.abort();
  state[kind] = newDirectory();
  state[kind].filters = { ...state[kind].filters, ...filters };
  navigate(kind);
}
function showDetails(kind, item, trigger) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = detailsView(kind, item);
  const dialog = wrapper.firstElementChild;
  root.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); trigger.focus(); }, { once: true });
  dialog.querySelector('#close-details').addEventListener('click', () => dialog.close());
  dialog.querySelector('#copy-id').addEventListener('click', async () => {
    const status = dialog.querySelector('#copy-status');
    try { await navigator.clipboard.writeText(item.id); status.textContent = 'ID copied.'; }
    catch { status.textContent = 'Select the ID above and copy it manually.'; dialog.querySelector('input').focus(); dialog.querySelector('input').select(); }
  });
  dialog.querySelector('#details-devices')?.addEventListener('click', () => { dialog.close(); accountDevices(item); });
  if (state.session.managementEnabled) {
    for (const descriptor of accountActions(kind, item, state.session.role)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button'; button.textContent = descriptor.label;
      button.onclick = () => { dialog.close(); showManagementAction(root, state.session, descriptor, item.id, () => { state[kind].data = null; }, trigger); };
      dialog.append(button);
    }
  }
  dialog.showModal();
}
async function signOut() {
  if (state.signingOut) return;
  const session = state.session;
  const generation = state.generation;
  state.signingOut = true; state.error = ''; render();
  try {
    await api('session', { method: 'DELETE', headers: { 'X-127v-admin-csrf': session.csrf } });
    if (generation === state.generation) clearSession();
  } catch (error) {
    if (generation !== state.generation) return;
    if (error.status === 401) { clearSession(); return; }
    state.signingOut = false; state.error = 'Sign-out was not confirmed. ' + message(error); render({ focus: 'signout' });
  }
}

root.innerHTML = '<main class="login-wrap"><section class="login" role="status"><h1>Connecting to your server…</h1><p class="muted">Checking your operator session.</p></section></main>';
try { setSession(await api('session')); }
catch (error) { state.error = error.status === 401 ? '' : message(error); login(); }

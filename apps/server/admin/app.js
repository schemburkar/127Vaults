import { escapeHtml, date, badge, newDirectory, directoryQuery, directoryView, detailsView } from './directory.js';

const root = document.querySelector('#app');
const titles = { overview: 'Overview', users: 'Users', invitations: 'Invitations', roles: 'Roles & ownership', devices: 'Devices', backups: 'Backups', settings: 'Settings', audit: 'Audit' };
const resource = () => ({ data: null, loading: false, error: '', checkedAt: null, request: 0, controller: null });
const state = { session: null, section: sectionFromHash(), overview: resource(), users: newDirectory(), devices: newDirectory(), invitations: newDirectory(), error: '', loginName: '', signingOut: false, generation: 0 };
let sessionTimer;

function sectionFromHash() { return Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : 'overview'; }
class ApiError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}
async function api(path, options = {}) {
  const timeout = AbortSignal.timeout(15_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response;
  try { response = await fetch(`/api/admin/${path}`, { credentials: 'same-origin', cache: 'no-store', ...options, signal }); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(timeout.aborted ? 'request_timeout' : 'network_unavailable');
  }
  let result;
  try { result = await response.json(); }
  catch { throw new ApiError('server_unavailable', response.status); }
  if (!response.ok) throw new ApiError(result.error || 'request_failed', response.status);
  return result;
}
function message(error) {
  return ({
    invalid_credentials: 'Check your operator name and password.',
    rate_limited: 'Too many sign-in attempts. Wait a minute, then try again.',
    admin_not_configured: 'Operator access is not configured. Create the local operator file and restart the server using the administration runbook.',
    local_only: 'Server administration is available only on a loopback deployment. Open the console on the local server.',
    forbidden: 'The server refused this request. Reload the page to obtain a fresh session and try again.',
    admin_data_unavailable: 'The server could not read its administration data. Check the API and database, then try again.',
    network_unavailable: 'Cannot reach the server. Check your connection and that the server is running, then try again.',
    request_timeout: 'The server took too long to respond. Check the server, then try again.',
    server_unavailable: 'The server returned an unavailable or unexpected response. Check the server, then try again.',
    invalid_directory_query: 'These filters could not be applied. Clear the filters and try again.',
  })[error.code] ?? 'The request could not be completed. Try again.';
}
function cancelRequests() {
  for (const key of ['overview', 'users', 'devices', 'invitations']) {
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
  state.invitations = newDirectory();
  state.error = error;
  state.signingOut = false;
  login();
}
function setSession(session) {
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
    element.textContent = sessionStatus();
    element.classList.toggle('session-warning', new Date(state.session.expiresAt).getTime() - Date.now() <= 5 * 60_000);
  }
}
function login() {
  root.innerHTML = `<main class="login-wrap"><form class="login" id="login-form"><div class="brand"><span class="brand-mark" aria-hidden="true">◇</span><span>127Vaults<small>Server administration</small></span></div><h1>Sign in to your server</h1><p class="server-origin">${escapeHtml(location.host)}</p><p class="muted">Use your local operator credentials. This session is separate from your vault.</p>${state.error ? `<p class="notice error" role="alert">${escapeHtml(state.error)}</p>` : ''}<label class="field">Operator name<input name="username" autocomplete="username" required value="${escapeHtml(state.loginName)}"></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label><button class="button primary" type="submit">Sign in</button><p class="footnote">Local administration · experimental server<br>Sessions expire after 30 minutes.</p></form></main>`;
  const form = document.querySelector('#login-form');
  form.elements[state.loginName ? 'password' : 'username'].focus();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true; button.textContent = 'Signing in…';
    const fields = new FormData(form);
    state.loginName = String(fields.get('username'));
    try {
      const session = await api('session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: state.loginName, password: fields.get('password') }) });
      form.reset();
      setSession(session);
    } catch (error) { state.error = message(error); login(); }
  });
}
function overview() {
  const o = state.overview.data;
  if (!o) return state.overview.loading ? '<section class="panel empty-state" role="status"><h2>Checking your server…</h2><p>Loading API, database and account status.</p></section>' : '<section class="panel empty-state"><h2>Server status is unavailable</h2><p>Retry the check to see current health.</p></section>';
  const backup = o.backup ?? { state: 'unknown' };
  const mismatch = o.schemaVersion !== o.expectedSchemaVersion;
  return `<p class="muted">Local server health and account activity. Checked ${escapeHtml(date(o.checkedAt))}.</p>${mismatch ? '<div class="notice error" role="alert"><strong>Database schema needs attention.</strong><p>The installed schema differs from the expected version. Follow the migration runbook before using the server.</p></div>' : ''}<div class="grid"><div class="card"><span class="label">API & database</span><span class="value">${escapeHtml(o.status)}</span>${badge(mismatch ? 'schema mismatch' : 'online')}</div><div class="card"><span class="label">Accounts</span><span class="value">${escapeHtml(o.users?.users ?? '—')}</span><span class="detail">${escapeHtml(o.users?.active_users ?? '—')} active</span><button class="text-button card-link" data-section="users" type="button">View accounts →</button></div><div class="card"><span class="label">Active devices</span><span class="value">${escapeHtml(o.activeDevices)}</span><span class="detail">Across all accounts</span><button class="text-button card-link" data-section="devices" type="button">View devices →</button></div><div class="card"><span class="label">Backup</span><span class="value">${escapeHtml(backup.state)}</span><span class="detail">${escapeHtml(backup.detail ?? 'No recent status available')}</span><button class="text-button card-link" data-section="backups" type="button">Review backup status →</button></div></div><div class="columns"><section class="panel"><h2>Server details</h2><dl class="details-list"><div><dt>Server address</dt><dd>${escapeHtml(location.host)}</dd></div><div><dt>Installed schema</dt><dd>${escapeHtml(o.schemaVersion)}</dd></div><div><dt>Expected schema</dt><dd>${escapeHtml(o.expectedSchemaVersion)}</dd></div></dl><p class="muted">Health reflects the live API and database check. Unknown backup status does not confirm a recent backup.</p></section><section class="panel"><h2>Operator access</h2><p class="muted">Signed in as ${escapeHtml(state.session.username)} (${escapeHtml(state.session.role)}). Session expires ${escapeHtml(date(state.session.expiresAt))}.</p><p class="muted">This admin session has no vault unlock state or vault keys.</p></section></div>`;
}
function roles() {
  return `<p class="muted">Server roles are separate from vault membership and access.</p><div class="columns"><section class="panel"><h2>Owner</h2><p class="muted">Controls ownership, licensing, destructive server operations and root settings. Also has admin capabilities.</p><ul class="list"><li>Can initiate owner grants and transfers when implemented.</li><li>Cannot remove the last active owner.</li><li>Does not automatically receive vault keys or content access.</li></ul></section><section class="panel"><h2>Server admin</h2><p class="muted">Handles delegated control-plane operations such as users, invitations, authentication locks and routine settings.</p><ul class="list"><li>Cannot add, remove or demote owners.</li><li>Has no automatic access to private or shared vaults.</li><li>Exact write permissions will be finalized before controls are enabled.</li></ul></section></div><div class="notice">Role and ownership changes are not available in this version. The current database supports one provisional vault-account owner. Operator roles apply to this separate read-only console.</div>`;
}
function backups() {
  if (!state.overview.data) return overview();
  const backup = state.overview.data.backup ?? { state: 'unknown', detail: 'No status available.' };
  return `<p class="muted">Backup visibility for this server. Checked ${escapeHtml(date(state.overview.data.checkedAt))}.</p><section class="panel"><h2>Current backup status</h2><p>${badge(backup.state)}</p><p class="muted">${escapeHtml(backup.detail)}</p>${backup.state === 'unknown' ? '<div class="notice">Backup freshness is unknown. Check the operator backup logs and your last restore rehearsal before relying on this server.</div>' : ''}<p class="footnote">Backup creation and restore remain in the operator runbook. This page does not initiate either action.</p></section>`;
}
function placeholder(name) { return `<section class="panel empty-state"><h2>${escapeHtml(name)} is coming later</h2><p>This area is reserved for a reviewed administration workflow.</p></section>`; }
const views = { overview, users: () => directoryView('users', state.users), invitations: () => directoryView('invitations', state.invitations), roles, devices: () => directoryView('devices', state.devices), backups, settings: () => placeholder('Settings'), audit: () => placeholder('Audit') };
function currentResource() { return ['overview', 'backups'].includes(state.section) ? state.overview : ['users', 'devices', 'invitations'].includes(state.section) ? state[state.section] : null; }
function render({ focus = '' } = {}) {
  if (!state.session) return;
  const active = document.activeElement;
  const previousFocus = active?.id || '';
  const navFocus = active?.dataset.section;
  const data = currentResource();
  const directory = ['users', 'devices', 'invitations'].includes(state.section);
  root.innerHTML = `<a class="skip-link" href="#main-content">Skip to content</a><div class="shell"><aside class="sidebar"><div class="brand"><span class="brand-mark" aria-hidden="true">◇</span><span>127Vaults<small>Server administration</small></span></div><nav class="nav" aria-label="Admin sections">${Object.entries(titles).map(([key, text]) => `<button type="button" data-section="${key}" class="${state.section === key ? 'active' : ''}" ${state.section === key ? 'aria-current="page"' : ''}>${text}</button>`).join('')}</nav><div class="sidebar-foot"><span class="server-origin">${escapeHtml(location.host)}</span><br>Local operator console<br>Experimental server</div></aside><main class="main" id="main-content" tabindex="-1"><header class="top"><div><p class="eyebrow">Control plane</p><h1 id="page-title" tabindex="-1">${titles[state.section]}</h1></div><div class="top-actions"><div><span class="operator">${escapeHtml(state.session.username)} · ${escapeHtml(state.session.role)}</span><span id="session-status" class="sub" role="status">${escapeHtml(sessionStatus())}</span></div><button class="button" id="signout" ${state.signingOut ? 'disabled' : ''}>${state.signingOut ? 'Signing out…' : 'Sign out'}</button></div></header>${state.error ? `<p class="notice error" role="alert">${escapeHtml(state.error)}</p>` : ''}${data ? `<div class="refresh-bar"><p class="muted" role="status">${data.loading ? 'Refreshing server data…' : data.checkedAt ? 'Last loaded ' + escapeHtml(date(data.checkedAt)) : 'Ready to check server data'}</p><button class="button" id="refresh-data" type="button" ${data.loading ? 'disabled' : ''}>${data.loading ? 'Refreshing…' : 'Refresh'}</button></div>` : ''}${!directory && data?.error ? `<div class="notice error" role="alert"><p>${escapeHtml(data.error)}</p>${data.data ? '<p>Showing the last loaded data. Current server health is unconfirmed.</p>' : ''}<button class="button" id="retry-data" type="button">Try again</button></div>` : ''}${views[state.section]()}</main></div>`;
  document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.section)));
  document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); document.querySelector('#main-content').focus(); });
  document.querySelector('#signout').addEventListener('click', signOut);
  document.querySelector('#refresh-data')?.addEventListener('click', () => loadSection(true, 'refresh-data'));
  document.querySelector('#retry-data')?.addEventListener('click', () => loadSection(true, 'refresh-data'));
  if (directory) bindDirectory(state.section);
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
  const key = section === 'backups' ? 'overview' : section;
  if (!['overview', 'users', 'devices', 'invitations'].includes(key) || !state.session) return;
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
    const data = await api(key + (key === 'overview' ? '' : '?' + directoryQuery(key, entry)), { signal: controller.signal });
    if (entry.request !== request || state.generation !== generation) return;
    entry.data = data; entry.checkedAt = new Date().toISOString();
    if (key !== 'overview') entry.page = data.page;
  } catch (error) {
    if (controller.signal.aborted || entry.request !== request || state.generation !== generation) return;
    if (error.status === 401) { clearSession('Your operator session expired or the server restarted. Sign in again to continue.'); return; }
    entry.error = message(error);
  } finally {
    if (entry.request === request && state.generation === generation) {
      entry.loading = false; entry.controller = null;
      if ((state.section === key || key === 'overview' && state.section === 'backups') && state.session) render({ focus });
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
    entry.filters = { ...entry.filters, q, status, sort: String(fields.get('sort') ?? 'newest'), ...(filter ? { [filter]: String(fields.get(filter) ?? '') } : {}) };
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
  state.devices.controller?.abort();
  state.devices = newDirectory();
  state.devices.filters.accountId = account.id;
  state.devices.accountName = account.displayName || account.username;
  navigate('devices');
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

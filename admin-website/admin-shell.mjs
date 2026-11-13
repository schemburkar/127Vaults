const pages = [
  ['access-admin', 'Access requests', 'Review and invite', '01'],
  ['licenses', 'Licenses', 'Installation access', '02'],
  ['subscriptions', 'Subscriptions', 'Plans and payments', '03'],
  ['coupons', 'Coupons', 'Private discounts', '04'],
  ['releases', 'Review releases', 'Packages and installers', '05'],
  ['customer-mail', 'Customer messages', 'Copy and send', '06'],
  ['cloud-tenants', 'Cloud tenants', 'Family pilot', '07'],
];
const page = location.pathname.split('/').pop().replace(/\.html$/, '') || 'access-admin';
const current = pages.find(([id]) => id === page) || pages[0];
const main = document.querySelector('main'); main.id = 'main'; main.classList.add('admin-main');
const content = document.createElement('div'); content.className = 'admin-content'; content.hidden = true;
content.append(...main.childNodes); main.append(content);
const sidebar = document.createElement('aside'); sidebar.className = 'admin-sidebar';
sidebar.innerHTML = '<a class="admin-brand" href="/access-admin"><img src="brand-mark.svg" width="36" height="36" alt=""><span>127Vaults<strong>Admin</strong></span></a><p class="admin-nav-label">WORKSPACE</p><nav aria-label="Admin navigation"></nav><div class="admin-sidebar-foot"><span class="admin-dot"></span>Private workspace</div>';
for (const [id, label, hint, number] of pages) {
  const a = document.createElement('a'); a.href = `/${id}`;
  if (id === current[0]) a.setAttribute('aria-current', 'page');
  a.innerHTML = `<span class="admin-nav-number" aria-hidden="true">${number}</span><span>${label}<small>${hint}</small></span>`;
  sidebar.querySelector('nav').append(a);
}
const top = document.createElement('header'); top.className = 'admin-topbar';
top.innerHTML = `<span>Admin <span aria-hidden="true">/</span> <strong>${current[1]}</strong></span><button class="desk-button" id="admin-logout" type="button" hidden>Sign out</button>`;
const layout = document.createElement('div'); layout.className = 'admin-workspace';
main.before(sidebar, layout); layout.append(top, main);
const login = document.createElement('form'); login.className = 'access-card admin-login';
login.innerHTML = '<h2>Operator sign-in</h2><p>Use your operator access key to open the private workspace. Sessions last one hour.</p><label class="access-field" for="admin-key">Operator access key<input id="admin-key" type="password" autocomplete="off" required></label><button class="button primary" type="submit">Sign in</button><p role="status" aria-live="polite" id="admin-login-status"></p>';
login.hidden = true; main.prepend(login);
export function requireSignIn(message = 'Your session has ended. Sign in to continue.') {
  document.dispatchEvent(new Event('admin-session-ended'));
  content.hidden = true; login.hidden = false;
  document.getElementById('admin-logout').hidden = true;
  document.getElementById('admin-login-status').textContent = message;
  document.querySelectorAll('.request-menu-items').forEach(node => node.remove());
}
export async function adminFetch(path, options = {}) {
  const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) requireSignIn();
  return response;
}
login.addEventListener('submit', async event => {
  event.preventDefault(); const input = document.getElementById('admin-key');
  const key = input.value.trim(); input.value = '';
  const button = login.querySelector('button'); button.disabled = true;
  try {
    const response = await adminFetch('/api/access-admin/session', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw Error('Access key not accepted.');
    location.reload();
  } catch (error) { requireSignIn(error.message); } finally { button.disabled = false; }
});
document.getElementById('admin-logout').addEventListener('click', async () => {
  try {
    const response = await adminFetch('/api/access-admin/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw Error('Sign out failed. Try again.');
    location.reload();
  } catch (error) { requireSignIn(error.message); }
});
export const adminReady = (async () => {
  if (page === 'cloud-tenants') {
    content.hidden = false;
    return true;
  }
  try {
    const response = await adminFetch('/api/access-admin/requests');
    if (!response.ok) { requireSignIn(response.status === 401 ? '' : 'The workspace could not be loaded. Try signing in again.'); return false; }
    content.hidden = false; document.getElementById('admin-logout').hidden = false; return true;
  } catch { requireSignIn('The workspace is unavailable. Try again.'); return false; }
})();

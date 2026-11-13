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
sidebar.innerHTML = '<a class="admin-brand" href="/access-admin"><img src="brand-mark.svg" width="36" height="36" alt=""><span>127Vaults<strong>Admin</strong></span></a><label class="nav-finder"><span>Find a page</span><input type="search" placeholder="Find a page…" aria-label="Find an admin page"></label><nav aria-label="Admin navigation"></nav><div class="admin-sidebar-foot"><span aria-hidden="true">◇</span> Operator workspace</div>';
const navigationOrder = ['access-admin','licenses','cloud-tenants','subscriptions','coupons','releases','customer-mail'];
for (const id of navigationOrder) {
  const [,label,hint,number] = pages.find(item=>item[0]===id);
  const group = id === 'access-admin' ? 'CUSTOMERS' : id === 'subscriptions' ? 'BILLING' : id === 'releases' ? 'OPERATIONS' : null;
  if (group) { const heading=document.createElement('p'); heading.className='admin-nav-label'; heading.textContent=group; sidebar.querySelector('nav').append(heading); }

  const a = document.createElement('a'); a.href = `/${id}`;
  if (id === current[0]) a.setAttribute('aria-current', 'page');
  a.innerHTML = `<span class="admin-nav-icon" aria-hidden="true">${({"access-admin":"▤",licenses:"◇","cloud-tenants":"▦",subscriptions:"↻",coupons:"%",releases:"↓","customer-mail":"✉"})[id]}</span><span>${label}</span>`;
  sidebar.querySelector('nav').append(a);
}
const navStatus=document.createElement('p');navStatus.className='nav-search-status';navStatus.setAttribute('role','status');navStatus.hidden=true;sidebar.querySelector('nav').after(navStatus);
sidebar.querySelector('input').addEventListener('input', event => {
  const term=event.target.value.toLowerCase();
  for (const a of sidebar.querySelectorAll('nav a')) a.hidden=!a.textContent.toLowerCase().includes(term);
  for(const heading of sidebar.querySelectorAll('nav .admin-nav-label'))heading.hidden=Boolean(term);
  navStatus.hidden=!term;navStatus.textContent=sidebar.querySelectorAll('nav a:not([hidden])').length+' matching pages';
});
const top = document.createElement('header'); top.className = 'admin-topbar';
top.innerHTML = `<div class="workspace-breadcrumb"><button class="nav-toggle desk-button" type="button" aria-label="Toggle admin navigation" aria-expanded="false">☰</button><span>Workspace</span><span aria-hidden="true">/</span><strong>${current[1]}</strong></div><div class="topbar-tools"><span class="workspace-badge">Private admin</span><button class="desk-button" id="admin-logout" type="button" hidden>Sign out</button></div>`;
const layout = document.createElement('div'); layout.className = 'admin-workspace';
main.before(sidebar, layout); layout.append(top, main);
top.querySelector('.nav-toggle').addEventListener('click',event=>{const expanded=document.body.classList.toggle('nav-open');event.currentTarget.setAttribute('aria-expanded',String(expanded));});
const pageHeader=document.createElement('header');pageHeader.className='workspace-page-header';
const pageCopy=document.createElement('div');const h1=content.querySelector('h1');const kicker=content.querySelector('.kicker');const description=h1?.nextElementSibling?.tagName==='P'?h1.nextElementSibling:null;
if(kicker)kicker.remove();if(h1)pageCopy.append(h1);if(description)pageCopy.append(description);
const pageActions=document.createElement('div');pageActions.className='page-actions';pageHeader.append(pageCopy,pageActions);content.prepend(pageHeader);
if(document.querySelector('meta[name="admin-review"]')){const notice=document.createElement('span');notice.className='workspace-badge warning';notice.textContent='LOCAL REVIEW · SAMPLE DATA';top.querySelector('.topbar-tools').prepend(notice);}
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

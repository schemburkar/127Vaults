import { adminReady } from './admin-shell.mjs';

const get = id => document.getElementById(id);
const status = get('cloud-status');
const directory = get('cloud-directory');
const create = get('cloud-create');
const setup = get('cloud-setup');
const link = get('cloud-setup-link');
let busy = false;

async function command(action, input = {}) {
  const response = await fetch(`/cloud-tenants/api/${action}`, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  }).catch(() => { throw Error('Reload this page and sign in through Cloudflare Access, then try again.'); });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw Error('Sign in with an authorized Cloud operator account and complete MFA.');
  if (!response.ok) throw Error(result.detail ?? 'The Cloud management service could not complete the request.');
  return result;
}

function clearLink() {
  link.value = '';
  setup.hidden = true;
}

async function run(action) {
  if (busy) return;
  busy = true;
  get('cloud-refresh').disabled = true;
  for (const button of document.querySelectorAll('#cloud-create button, #cloud-directory button')) button.disabled = true;
  try { await action(); }
  catch (error) { status.textContent = error.message; }
  finally {
    busy = false;
    get('cloud-refresh').disabled = false;
    for (const button of document.querySelectorAll('#cloud-create button, #cloud-directory button')) button.disabled = false;
  }
}

function appendText(parent, tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  parent.append(node);
  return node;
}

function tenantCard(tenant) {
  const card = document.createElement('section');
  card.className = 'access-card';
  appendText(card, 'h2', tenant.host);
  appendText(card, 'p', `Vault URL: https://${tenant.host} · Deployment: ${tenant.region}`);
  appendText(card, 'p', `Status: ${tenant.readyToActivate ? 'Ready to activate' : tenant.state} · Control owner: ${tenant.controlOwnerEmail ?? 'Unlinked'}`);
  appendText(card, 'p', `${tenant.activeUsers} active · ${tenant.reservedSeats} reserved · ${tenant.maxActiveUsers} seats allowed`);
  const action = (label, name, confirmation) => {
    const button = appendText(card, 'button', label);
    button.className = 'button';
    button.type = 'button';
    button.addEventListener('click', () => run(async () => {
      if (confirmation && !window.confirm(`${confirmation} ${tenant.host}?`)) return;
      clearLink();
      const result = await command(name, { host: tenant.host });
      if (name === 'issue-setup') {
        link.value = result.setupUrl;
        setup.hidden = false;
        link.focus();
        status.textContent = 'Owner setup link issued.';
      } else await refresh();
    }));
  };
  if (tenant.state === 'prepared' && !tenant.readyToActivate) action('Issue or replace setup link', 'issue-setup', 'Issue a new owner setup link for');
  if (tenant.readyToActivate) action('Activate tenant', 'activate', 'Activate');
  if (tenant.state === 'active') action('Suspend tenant', 'suspend', 'Suspend');
  if (tenant.state === 'suspended') action('Resume tenant', 'resume', 'Resume');
  if (tenant.state !== 'deleting') {
    const form = document.createElement('form');
    const label = appendText(form, 'label', 'New seat cap ');
    const seats = document.createElement('input');
    Object.assign(seats, { type: 'number', min: '1', max: '2147483647', required: true, value: String(tenant.maxActiveUsers) });
    label.append(seats);
    appendText(form, 'button', 'Update seat cap').className = 'button';
    form.addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        clearLink();
        await command('set-seats', { host: tenant.host, maxActiveUsers: seats.valueAsNumber });
        await refresh();
      });
    });
    card.append(form);
  }
  return card;
}

async function refresh() {
  const tenants = await command('list');
  directory.replaceChildren(...tenants.map(tenantCard));
  create.hidden = false;
  status.textContent = tenants.length ? `${tenants.length} tenants loaded.` : 'No Cloud tenants yet.';
}

create.addEventListener('submit', event => {
  event.preventDefault();
  const fields = new FormData(create);
  void run(async () => {
    clearLink();
    await command('provision', { host: fields.get('host').trim().toLowerCase(), maxActiveUsers: Number(fields.get('seats')),
      ownerIdentityId: fields.get('owner').trim().toLowerCase(), ownerEmail: fields.get('email').trim().toLowerCase() });
    create.reset();
    await refresh();
  });
});
get('cloud-refresh').addEventListener('click', () => run(refresh));
get('cloud-clear').addEventListener('click', clearLink);
get('cloud-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(link.value); status.textContent = 'Setup link copied.'; }
  catch { link.select(); status.textContent = 'Select and copy the setup link.'; }
});
window.addEventListener('pagehide', clearLink);
if (await adminReady) await run(refresh);

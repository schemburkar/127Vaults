import {createDrawer,createDataView,identity,badge,actionButton,pageActions,confirmOperation} from './workspace-ui.mjs';
import { adminReady } from './admin-shell.mjs';

const get = id => document.getElementById(id);
const status = get('cloud-status');
const directory = get('cloud-directory');
const create = get('cloud-create');
const setup = get('cloud-setup');
const link = get('cloud-setup-link');
let busy = false, selectedSlug = null, grid;
const drawer=createDrawer();drawer.dialog.addEventListener('drawer-dismiss',clearLink);
pageActions()?.append(actionButton('Create tenant',button=>{selectedSlug=null;clearLink();drawer.actions.replaceChildren();drawer.footer.replaceChildren();drawer.setTitle('Create Cloud tenant','Tenant address, capacity and verified control owner.','CLOUD TENANTS');create.hidden=false;drawer.body.replaceChildren(create);drawer.open(button);},true));
get('cloud-refresh').hidden=true;


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
  const priorButtons = [...document.querySelectorAll('#cloud-create button, #cloud-directory button, .tenant-detail button, .drawer-actions button, .drawer-footer button')].map(button=>[button,button.disabled]);
  for (const [button] of priorButtons) button.disabled = true;
  try { await action(); }
  catch (error) { status.textContent = error.message; if(drawer.dialog.open){const note=document.createElement('p');note.className='workspace-error';note.textContent=error.message;drawer.body.prepend(note);} }
  finally {
    busy = false;
    get('cloud-refresh').disabled = false;
    for (const [button,wasDisabled] of priorButtons) if(button.isConnected)button.disabled=wasDisabled;
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
  card.className = 'access-card tenant-detail';
  drawer.actions.replaceChildren();drawer.footer.replaceChildren();
  const summary=document.createElement('section');summary.className='detail-summary';
  for(const [label,value]of [['Status',tenant.readyToActivate?'Ready to activate':tenant.state],['Region',tenant.region],['Control owner',tenant.controlOwnerEmail??'Unlinked'],['Capacity',tenant.activeUsers+' active · '+tenant.reservedSeats+' reserved · '+tenant.maxActiveUsers+' seats'],['Vault address',tenant.canonicalUrl]]){const line=document.createElement('div');appendText(line,'small',label);appendText(line,'strong',value);summary.append(line);}card.append(summary);
  const action = (label, name, confirmation) => {
    const button = appendText(drawer.actions, 'button', label);
    button.className = 'button'+(name==='suspend'?' danger':'');
    button.type = 'button';
    button.addEventListener('click', () => run(async () => {
      if (confirmation && !await confirmOperation(label,`${confirmation} ${tenant.slug}? Control owner: ${tenant.controlOwnerEmail||'Unlinked'}.`,button)) return;
      clearLink();
      const result = await command(name, { slug: tenant.slug });
      if (name === 'issue-setup') {
        link.value = result.setupUrl;
        drawer.body.append(setup); setup.hidden = false;
        link.focus();
        status.textContent = 'Owner setup link issued.';
      } else await refresh();
    }));
  };
  if (tenant.state === 'prepared' && !tenant.readyToActivate) action('Issue owner setup link', 'issue-setup', 'Issue a new link, invalidating any previous owner setup link, for');
  if (tenant.readyToActivate) action('Activate tenant', 'activate', 'Activate');
  if (tenant.state === 'active') action('Suspend tenant', 'suspend', 'Suspend');
  if (tenant.state === 'suspended') action('Resume tenant', 'resume', 'Resume');
  if (tenant.state !== 'deleting') {
    const form = document.createElement('form');form.id='tenant-seat-settings';appendText(form,'h3','Seat capacity');appendText(form,'p','Change the seat cap for this tenant. Existing users and reserved seats are checked by the service.');
    const label = appendText(form, 'label', 'New seat cap ');
    const seats = document.createElement('input');
    Object.assign(seats, { type: 'number', min: '1', max: '2147483647', required: true, value: String(tenant.maxActiveUsers) });
    label.append(seats);
    const save=appendText(drawer.footer,'button','Save seat cap');save.className='button primary';save.type='submit';save.setAttribute('form',form.id);
    form.addEventListener('submit', event => {
      event.preventDefault();
      void run(async () => {
        clearLink();
        await command('set-seats', { slug: tenant.slug, maxActiveUsers: seats.valueAsNumber });
        await refresh();
      });
    });
    card.append(form);
  }
  return card;
}

async function refresh() {
  const tenants = await command('list');
  if(!grid)grid=createDataView(directory,{title:'Tenants',searchLabel:'Search tenants by slug or control owner',searchText:r=>[r.slug,r.controlOwnerEmail,r.state,r.region].join(' '),views:[{id:'all',label:'All tenants',test:()=>true},{id:'active',label:'Active',test:r=>r.state==='active'},{id:'setup',label:'Setup pending',test:r=>r.state==='prepared'},{id:'suspended',label:'Suspended',test:r=>r.state==='suspended'}],columns:[{key:'slug',label:'Tenant',render:r=>identity(r.slug,r.canonicalUrl)},{key:'state',label:'Status',render:r=>badge(r.readyToActivate?'Ready to activate':r.state,r.state==='active'?'success':'')},{key:'controlOwnerEmail',label:'Control owner',render:r=>r.controlOwnerEmail||'Unlinked'},{key:'activeUsers',label:'Active users'},{key:'maxActiveUsers',label:'Seat cap'},{key:'region',label:'Region'}],toolbarActions:[actionButton('Refresh',()=>run(refresh))],onOpen:(tenant,button)=>{selectedSlug=tenant.slug;clearLink();drawer.setTitle(tenant.slug,tenant.controlOwnerEmail||'No linked control owner','CLOUD TENANT');drawer.body.replaceChildren(tenantCard(tenant),setup);drawer.open(button,tenant.slug);}});
  grid.setRows(tenants);
  if(drawer.dialog.open&&selectedSlug){const selected=tenants.find(r=>r.slug===selectedSlug);if(selected)drawer.body.replaceChildren(tenantCard(selected),setup);else drawer.close();}
  status.textContent = tenants.length ? `${tenants.length} tenants loaded.` : 'No Cloud tenants yet.';
}

create.addEventListener('submit', event => {
  event.preventDefault();
  const fields = new FormData(create);
  void run(async () => {
    clearLink();
    if(!await confirmOperation('Create tenant',`Provision ${fields.get('slug')} for ${fields.get('email')} with ${fields.get('seats')} seats?`))return;
    await command('provision', { slug: fields.get('slug').trim().toLowerCase(), maxActiveUsers: Number(fields.get('seats')),
      ownerIdentityId: fields.get('owner').trim().toLowerCase(), ownerEmail: fields.get('email').trim().toLowerCase() });
    create.reset();
    await refresh();drawer.close();
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

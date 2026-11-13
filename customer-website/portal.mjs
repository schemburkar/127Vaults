import {availableManageViews,accountSummary,selectManageView} from './manage-state.mjs';
import { portalApi, establishInvitationSession, parseInvitation } from './portal-client.mjs';
import { mountBilling } from './billing.mjs';
import { setupPasskeys, renderPasskeys } from './passkeys.mjs';
const $ = id => document.getElementById(id);
let challengeId,accountSerial=0,accountValue,activeView='overview',initialViewApplied=false,authSerial=0;
async function run(work,output=$('portal-status')) {
  const buttons = [...document.querySelectorAll('button')].filter(button=>!button.closest('form[method="dialog"]')).map(button=>[button,button.disabled]); buttons.forEach(([button])=>{button.disabled=true;});document.querySelector('main').setAttribute('aria-busy','true');
  try { output.textContent='';await work(); } catch (error) { output.textContent = error.message; }
  finally { buttons.forEach(([button,disabled])=>{if(button.isConnected)button.disabled=disabled;});document.querySelector('main').setAttribute('aria-busy','false'); }
}
function link(label, path, primary = false) { const node = document.createElement('a'); node.className = `button ${primary ? 'primary' : 'secondary'}`; node.textContent = label; node.href = path; return node; }
const query = new URLSearchParams(location.search);
const subscribing = query.get('subscribe') === 'personal';let authMode=subscribing?'signup':'signin';
let signupChallengeId;
function showLogin() {
  $('portal-status').after($('passkey-status'));document.body.dataset.manageState='auth';$('manage-auth').hidden=false;$('portal-account').hidden=true;
  $('portal-login').hidden=authMode!=='signin';$('portal-signup').hidden=authMode!=='signup';
  $('portal-existing-title').hidden=true;$('portal-signup-alternative').hidden=true;
  $('portal-title').textContent='127Vaults Manage';
  $('portal-description').textContent=authMode==='signup'?'Verify your email, then review your Personal subscription.':'Sign in for your subscriptions, downloads and account security.';
  for(const button of document.querySelectorAll('[data-auth-mode]'))button.setAttribute('aria-pressed',String(button.dataset.authMode===authMode));
}
function resetEmailStep(signup=false){
  authSerial++;
  const start=$(signup?'signup-start':'email-start'),complete=$(signup?'signup-complete':'email-complete');start.hidden=false;complete.hidden=true;
  $(signup?'signup-code':'code').value='';if(signup)signupChallengeId=null;else challengeId=null;
}
for(const button of document.querySelectorAll('[data-auth-mode]'))button.addEventListener('click',()=>{authMode=button.dataset.authMode;const url=new URL(location.href);if(authMode==='signup')url.searchParams.set('subscribe','personal');else url.searchParams.delete('subscribe');history.replaceState(null,'',url.pathname+url.search);resetEmailStep();resetEmailStep(true);$('portal-status').textContent='';$('signup-status').textContent='';showLogin();$(authMode==='signup'?'signup-email':'email').focus();});
$('signin-change-email').addEventListener('click',()=>{resetEmailStep();$('portal-status').textContent='';$('email').focus();});
$('signup-change-email').addEventListener('click',()=>{resetEmailStep(true);$('signup-status').textContent='';$('signup-email').focus();});
function setAccountView(name){
  if(!accountValue)return;activeView=selectManageView(name,accountValue);
  const sections={overview:'manage-overview',subscriptions:'portal-orders',cloud:'portal-cloud',security:'passkey-settings',plans:'portal-plans'};
  for(const [view,id]of Object.entries(sections))$(id).hidden=view!==activeView;
  for(const button of $('manage-account-nav').querySelectorAll('button'))button.setAttribute('aria-current',button.dataset.view===activeView?'page':'false');
  const url=new URL(location.href);url.searchParams.set('view',activeView);history.replaceState(null,'',url.pathname+url.search);
}
function renderWorkspace(value){
  accountValue=value;const labels={overview:'Overview',subscriptions:'Subscriptions & access',cloud:'Cloud workspaces',security:'Sign-in & security',plans:'Plans'};
  $('manage-account-nav').replaceChildren();for(const view of availableManageViews(value)){const button=element('button',labels[view]);button.type='button';button.dataset.view=view;button.addEventListener('click',()=>setAccountView(view));$('manage-account-nav').append(button);}
  const summary=accountSummary(value),overview=$('manage-overview');overview.replaceChildren();
  const metrics=element('div','', 'manage-summary-grid');
  for(const [label,count,view]of [['Self-hosted access',summary.access,'subscriptions'],['Active subscriptions',summary.activeSubscriptions,'subscriptions'],['Cloud workspaces',summary.cloud,'cloud']]){const card=element('button','', 'manage-summary-card');card.type='button';card.append(element('span',label),element('strong',String(count??'—')));if(availableManageViews(value).includes(view))card.addEventListener('click',()=>setAccountView(view));else card.disabled=true;metrics.append(card);}overview.append(metrics);
  const next=element('section','', 'access-card manage-next-step');next.append(element('span','YOUR NEXT STEP','trial-section-label'));
  const current=value.requests.find(row=>row.state==='approved')??value.requests.find(row=>row.billingStatus)??value.requests[0];
  if(current){next.append(element('h2',planName(current.plan)),element('p',orderStatus(current)));if(current.state==='approved')next.append(link('Downloads and setup','/trial?request='+encodeURIComponent(current.id),true));else if(current.billingStatus)next.append(orderLink(current,'Review subscription'));else next.append(element('p','Your access request is being reviewed. You can check its status under Subscriptions & access.'));}
  else if(value.cloudTenants?.length){next.append(element('h2','Your Cloud workspace'),element('p','Review your family workspace and access its settings.'),viewButton('View Cloud workspaces','cloud'));}
  else if(value.cloudUnavailable){next.append(element('h2','Cloud details are unavailable'),element('p','Your account is signed in. Open Cloud workspaces for the current status, or try again later.'),viewButton('View Cloud status','cloud'));}
  else{next.append(element('h2','Your account is ready'),element('p',value.scope==='email'?'Choose a plan or open an invitation to get started.':'This invitation has no available access. Contact your inviter for help.'));if(value.scope==='email')next.append(viewButton('Explore plans','plans'));}
  overview.append(next);
  if(value.scope!=='email')overview.append(element('p','This session is limited to the invitation you opened. Sign out and verify your email to see all of your account.','manage-scope-note'));
  function viewButton(text,view){const button=element('button',text,'button primary');button.type='button';button.addEventListener('click',()=>setAccountView(view));return button;}
}
function clearAccount(){activeView='overview';initialViewApplied=false;accountSerial++;accountValue=null;$('portal-account').hidden=true;$('portal-requests').replaceChildren();$('portal-cloud-tenants').replaceChildren();$('passkey-list').replaceChildren();$('manage-overview').replaceChildren();$('portal-identity').textContent='';$('personal-consent').checked=false;const panel=$('billing-panel');if(panel.open)panel.close();panel.replaceWith(billingPanel.cloneNode(true));}
function element(tag, label, className) {
  const node = document.createElement(tag);
  if (label) node.textContent = label;
  if (className) node.className = className;
  return node;
}
const planName = plan => ({
  personal: 'Personal Self-Hosted', commercial: 'Commercial Self-Hosted', cloud: '127Vaults Cloud',
})[plan?.startsWith('commercial-') ? 'commercial' : plan] ?? plan;
function renderPlans(value) {
  $('portal-plans').hidden = value.scope !== 'email';
  $('personal-buy').hidden = !value.canBuyPersonal;
  const target = $('personal-installation');
  const selected = target.value;
  const options = value.requests.filter(row => row.convertible);
  target.replaceChildren(element('option', 'Set up a new installation'));
  target.firstChild.value = '';
  for (const row of options) {
    const option = element('option', `Convert ${orderKind(row)} · Server ${row.installationId.slice(0, 8)}`);
    option.value = row.id;
    target.append(option);
  }
  if (options.some(row => row.id === selected)) target.value = selected;
  target.closest('label').hidden = !options.length;
  const order = value.requests.find(row => row.plan === 'personal' && row.billingStatus && row.billingMode === value.purchaseMode);
  $('personal-plan-action').replaceChildren();
  if (!value.canBuyPersonal && order && value.scope === 'email') {
    const label = ({ offered: 'Continue checkout', checkout_pending: 'Continue checkout', failed: 'Retry payment', cancelled: 'Subscribe again', expired: 'Subscribe again' })[order.billingStatus] ?? 'Manage plan';
    $('personal-plan-action').append(orderLink(order, label));
  }
  $('personal-test').hidden = value.purchaseMode !== 'test_mode';
  $('personal-terms-copy').textContent = value.purchaseMode === 'test_mode'
    ? ' for this test checkout. Use a Dodo test card.'
    : ' and agree to annual billing at $20 USD plus applicable tax.';
}
const billingPanel = $('billing-panel').cloneNode(true);
$('portal-account').prepend(document.querySelector('.portal-session'));document.querySelector('.portal-session').after($('portal-return'));
function orderLink(row, label) {
  const order = link(label, `${row.billingStatus?'/billing':'/portal?view=subscriptions&record=1'}${row.billingStatus?'?':'&'}request=${encodeURIComponent(row.id)}`);
  order.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const panel = billingPanel.cloneNode(true);
    $('billing-panel').replaceWith(panel);
    panel.querySelector('#billing-reference').textContent = planName(row.plan)+' · Ref '+row.id.slice(0,8)+' · '+orderStatus(row);
    const summary=element('section','', 'manage-detail-grid');for(const [title,value]of [['Access',orderKind(row)],['Users',row.maxUsers?String(row.maxUsers):'Not yet approved'],['Installation',row.installationId||'Not activated'],['End date',row.paidThrough||row.expiresAt?new Date(row.paidThrough??row.expiresAt).toLocaleDateString():'Not started']]){const field=element('div');field.append(element('small',title),element('strong',value));summary.append(field);}panel.querySelector('#billing-reference').after(summary);panel.querySelector('#billing-title').textContent=planName(row.plan);

    if (row.state === 'approved') {
      panel.querySelector('#billing-download').append(link('Downloads and license', `/trial?request=${encodeURIComponent(row.id)}`));
    }
    if(row.state==='approved'){
      if(!row.conversion)addPrivateLinkAction('Get installer setup link','installer-link','Open setup link');
      if(accountValue?.scope==='email')addPrivateLinkAction('Share client downloads','client-link','Open client joining page');
    }
    function addPrivateLinkAction(label,endpoint,openLabel){const button=element('button',label,'button secondary');button.type='button';button.addEventListener('click',()=>run(async()=>{const result=await portalApi(endpoint,{requestId:row.id});const url=new URL(result.link);if(url.origin!==location.origin||!['/trial','/trial.html','/join','/join.html'].includes(url.pathname))throw Error('The private link could not be verified.');const box=element('div','', 'manage-private-link');const note=element('p',endpoint==='client-link'?'Client apps only. This does not grant server administration or create a vault account.':'Use this private link in the installer. Keep it within your authorized installation.');const input=element('input');input.readOnly=true;input.value=result.link;input.setAttribute('aria-label',label);const copy=element('button','Copy link','button secondary');copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(input.value);note.textContent='Link copied. Share it only with the intended recipient.';}catch{input.select();note.textContent='Select and copy the link.';}});box.append(note,input,copy,link(openLabel,result.link));button.replaceWith(box);},panel.querySelector('#status')));panel.querySelector('#billing-download').append(button);}
    panel.addEventListener('close',()=>order.focus(),{once:true});panel.showModal();
    if(row.billingStatus)mountBilling(panel,row.id);else panel.querySelector('#status').textContent=row.state==='requested'?'Your access request is awaiting approval.':orderStatus(row);

  });
  return order;
}
function orderStatus(row) {
  if (row.billingStatus === 'active' && row.state === 'purchase_pending') return 'Verifying subscription';
  if (row.cancelAtPeriodEnd && row.billingStatus === 'active') return 'Cancellation scheduled';
  return ({
    offered: 'Ready for checkout', checkout_pending: 'Payment pending', active: 'Active',
    failed: 'Payment failed', cancelled: 'Cancelled', expired: 'Expired', on_hold: 'On hold',
    past_due: 'Past due', paused: 'Paused', refunded: 'Refunded', disputed: 'Disputed',
  })[row.billingStatus] ?? (row.billingStatus ? 'Processing' : ({
    approved: row.expiresAt && Date.parse(row.expiresAt) <= Date.now() ? 'Expired' : 'Approved',
    requested: 'Awaiting review', closed: 'Closed', rejected: 'Declined', converted: 'Converted to Personal',
  })[row.state] ?? 'Pending');
}
function orderKind(row) {
  if (row.billingMode === 'test_mode') return 'Test subscription';
  if (row.kind === 'development') return 'Development license';
  if (row.billingStatus) return 'Subscription';
  if (row.kind === 'trial') return 'Unpaid trial';
  return 'Access request';
}
function renderOrders(value) {
  const query=new URLSearchParams(location.search);
  const rows = [...value.requests].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const returning = query.get('billing') === 'return';
  // Older hosted sessions return without the order reference.
  const selected = query.get('request') ?? (returning
    ? rows.filter(row => row.checkoutStartedAt).sort((a, b) => Date.parse(b.checkoutStartedAt) - Date.parse(a.checkoutStartedAt))[0]?.id
    : undefined);
  const current = rows.find(row => row.id === selected);
  const notice = $('portal-return');
  notice.hidden = !returning || !current;
  if (!notice.hidden) {
    const confirmed = current.state === 'approved' && Boolean(current.paidThrough);
    const detail = confirmed ? `${current.billingMode === 'test_mode' ? 'Test subscription' : 'Subscription'} confirmed. Your downloads and license setup are ready.`
      : current.billingStatus === 'failed' ? 'Payment did not complete. Access is still locked.'
      : 'We’re confirming your subscription. Downloads will appear here once access is ready.';
    notice.textContent = `${planName(current.plan)} — ${detail}`;
  }
  const body = $('portal-requests');
  body.replaceChildren();
  $('portal-orders').hidden = !rows.length;
  if(!rows.length){const tr=element('tr'),td=element('td','No subscriptions or self-hosted access requests yet.');td.colSpan=5;tr.append(td);body.append(tr);}
  if (current) {
    rows.splice(rows.indexOf(current), 1);
    rows.unshift(current);
  }
  for (const row of rows) {
    const entry = element('tr');
    if (row === current) entry.className = 'portal-selected-order';
    const name = element('th', planName(row.plan));
    name.scope = 'row';
    name.append(element('small', `Ref ${row.id.slice(0, 8)}`));
    if (row.installationId) {
      const installation = element('small', `Server ${row.installationId.slice(0, 8)}`);
      installation.title = row.installationId;
      name.append(installation);
    }
    if (row.maxUsers) name.append(element('small', `${row.maxUsers} licensed users`));
    const kind = element('td');kind.dataset.label='Access type';
    kind.append(element('span', orderKind(row), row.billingMode === 'test_mode' || row.kind === 'development' ? 'portal-state' : ''));
    const end = row.state === 'purchase_pending' ? null : row.paidThrough ?? row.expiresAt;
    const dates = element('td', end ? new Date(end).toLocaleDateString() : '—');
    dates.dataset.label='End date';
    if (end) dates.append(element('small', row.paidThrough
      ? row.billingMode === 'test_mode' ? 'Test period ends' : 'Subscription active through'
      : 'License expires'));
    const action = element('td');action.dataset.label='Actions';
    const actions = element('div', '', 'portal-table-actions');
    if(row.state==='approved')actions.append(link('Downloads and setup','/trial?request='+encodeURIComponent(row.id),true));
    actions.append(orderLink(row,row.billingStatus?'Manage subscription':'View access details'));
    action.append(actions);
    entry.append(name, kind, (()=>{const td=element('td');td.dataset.label='Status';td.append(element('span',orderStatus(row),'portal-state '+(row.billingStatus==='active'&&row.state==='approved'?'success':'')));return td;})(), dates, action);
    body.append(entry);
  }
}
async function billingPost(path, value) {
  const response = await fetch('/api/billing/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  if (!response.ok) throw Error('Checkout could not be opened. Check your order below or contact support.');
  return response.json();
}
$('personal-buy').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const convertRequestId = $('personal-installation').value;
    const { requestId } = await billingPost('personal-order', { acceptTerms: $('personal-consent').checked,
      ...(convertRequestId ? { convertRequestId } : {}) });
    try {
      const { checkoutUrl } = await billingPost(`${encodeURIComponent(requestId)}/checkout`, {});
      const destination = new URL(checkoutUrl);
      if (destination.protocol !== 'https:' || !/(^|\.)dodopayments\.com$/.test(destination.hostname)) throw Error('Invalid checkout destination.');
      location.assign(destination.href);
    } catch (error) {
      await account();
      throw error;
    }
  });
});
async function account() {
  const serial=++accountSerial,route=new URLSearchParams(location.search);
  let value = await portalApi('me');
  if (route.get('billing') === 'return') {
    const selected = route.get('request');
    const pending = selected && value.requests.find(row => row.id === selected && row.state === 'purchase_pending'
      && ['active', 'checkout_pending'].includes(row.billingStatus));
    if (pending) {
      try {
        await billingPost(`${encodeURIComponent(pending.id)}/refresh`, {});
        value = await portalApi('me');
      } catch {
        // A delayed confirmation should still show the order and its current status.
      }
    }
  }
  if(serial!==accountSerial)return;document.body.dataset.manageState='account';$('manage-auth').hidden=true;
  $('portal-title').textContent=value.scope==='email'?'Your account':'Your invitation';$('portal-description').textContent='Subscriptions, server setup and account security, in one place.';
  $('portal-login').hidden = true; $('portal-account').hidden = false;
  $('portal-signup').hidden = true; $('portal-existing-title').hidden = true;
  $('portal-signup-alternative').hidden = true;
  $('portal-identity').textContent = value.email ? `Signed in as ${value.email}` : value.scope === 'installer' ? 'Signed in with an installer setup link. This session opens installation downloads and licensing only.' : 'Signed in with an invitation. This session opens only that invitation.';
  const cloud = $('portal-cloud');
  const tenants = value.cloudTenants ?? [];
  cloud.hidden = !tenants.length && !value.cloudUnavailable;
  const cloudCards = $('portal-cloud-tenants');
  cloudCards.replaceChildren();
  if (value.cloudUnavailable) cloudCards.textContent = 'Cloud details are temporarily unavailable.';
  for (const tenant of tenants) {
    if (typeof tenant.slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tenant.slug)) continue;
    const canonicalUrl = `https://cloud.127vaults.com/t/${tenant.slug}/`;
    if (tenant.canonicalUrl !== canonicalUrl) continue;
    const card = document.createElement('article'); card.className = 'access-card portal-request';
    const title = document.createElement('h3'); title.textContent = tenant.slug;
    const summary = document.createElement('p');
    const state = { reserved: 'Reserved', prepared: 'Awaiting activation', active: 'Active', suspended: 'Suspended' }[tenant.state] ?? tenant.state;
    summary.textContent = `${state} · ${tenant.maxActiveUsers} seats allocated by 127Vaults`;
    const note = document.createElement('p'); note.textContent = 'Billing and seat purchases are arranged with 127Vaults during the pilot.';
    card.append(title, summary, note);
    if (tenant.state === 'active') {
      const signIn = document.createElement('p');
      signIn.textContent = 'Family settings require a separate vault-owner sign-in.';
      card.append(link('Open family settings', `${canonicalUrl}?settings=family`), signIn);
    }
    cloudCards.append(card);
  }
  renderPlans(value);
  renderWorkspace(value);
  renderOrders(value);
  $('passkey-settings').querySelector('h2').after($('passkey-status'));
  try{await renderPasskeys(value.scope === 'email');}catch(error){if(error.status===401)throw error;$('passkey-status').textContent='Passkey settings are temporarily unavailable. You can still use the rest of your account.';}
  if(serial!==accountSerial)return;setAccountView(initialViewApplied?activeView:route.get('view')??(route.get('billing')==='return'?'subscriptions':null)??(authMode==='signup'&&value.canBuyPersonal?'plans':activeView));initialViewApplied=true;
  $('portal-status').textContent = value.requests.length || value.canBuyPersonal || !cloud.hidden ? '' : 'There are no available requests for this session. Verify your email or use a current invitation.';
}
$('email-start').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const serial=++authSerial,email=$('email').value.trim();const result = await portalApi('start', { email });if(serial!==authSerial)return;challengeId = result.challengeId;
  $('email-start').hidden=true;$('email-code-context').textContent='Enter the code sent to '+email+'.';
  $('email-complete').hidden = false; $('portal-status').textContent = result.message; $('code').value = ''; $('code').focus();
}); });
$('signup-start').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const serial=++authSerial,email=$('signup-email').value.trim();const result = await portalApi('start', { email });if(serial!==authSerial)return;
  signupChallengeId = result.challengeId;
  $('signup-start').hidden=true;$('signup-code-context').textContent='Enter the code sent to '+email+'.';
  $('signup-complete').hidden = false;
  $('signup-status').textContent = result.message;
  $('signup-code').value = ''; $('signup-code').focus();
}); });
$('signup-complete').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  await portalApi('complete', { challengeId: signupChallengeId, code: $('signup-code').value.trim() });
  $('signup-code').value = ''; await account();
  setAccountView('plans');$('portal-plans').scrollIntoView({ block: 'start' });
}); });
$('email-complete').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  await portalApi('complete', { challengeId, code: $('code').value.trim() }); $('code').value = ''; await account();
}); });
$('invite-login').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const value = parseInvitation($('invitation').value.trim()); await establishInvitationSession(value.requestId, value.token);
  $('invitation').value = ''; await account();
}); });
$('portal-logout').addEventListener('click', () => run(async () => {
  await portalApi('logout', {});authMode='signin';const url=new URL(location.href);url.searchParams.delete('subscribe');url.searchParams.delete('view');history.replaceState(null,'',url.pathname+url.search);clearAccount();resetEmailStep();resetEmailStep(true);for(const id of ['email','signup-email','passkey-name'])$(id).value='';showLogin();
  $('portal-cloud').hidden = true; $('portal-cloud-tenants').replaceChildren();
  $('personal-consent').checked = false;
  $('portal-requests').replaceChildren(); $('portal-identity').textContent = ''; $('portal-status').textContent = 'Signed out.';
}));
document.addEventListener('manage-session-ended',()=>{clearAccount();resetEmailStep();resetEmailStep(true);showLogin();});
setupPasskeys(account);
account().catch(error => { showLogin(); $('portal-status').textContent = error.status === 401 ? '' : error.message; });

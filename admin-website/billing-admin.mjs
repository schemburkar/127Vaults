import {createDrawer,createDataView,enhanceSelect,identity,badge,actionButton,pageActions,confirmOperation,formatMinorAmount,el} from './workspace-ui.mjs';
import { subscriptionActionReason } from './billing-actions.mjs';
import { loadRequests, billingModeLabel } from './request-data.mjs';
import { adminReady, adminFetch } from './admin-shell.mjs';
const isCoupons = document.body.dataset.adminPage === 'coupons';
const inbox = document.getElementById('inbox');
const drawer=createDrawer(), serviceDrawer=createDrawer();let newOfferMode=false,recordVersion=0;drawer.dialog.addEventListener('drawer-dismiss',()=>{recordVersion++;});
let grid, couponPage=0, couponRows=[], currentCoupon=null;
function openBilling(row,button){
  recordVersion++;status.textContent='';session.value='';panel.querySelector('#subscription-payment-history')?.remove();
  newOfferMode=!row; groups.offer.hidden=Boolean(row?.billingStatus&&!['cancelled','failed','expired'].includes(row.billingStatus));groups.payments.hidden=!row?.billingStatus;groups.recovery.hidden=row?.billingStatus!=='checkout_pending';groups.renewal.hidden=!row?.billingStatus;groups.health.hidden=true;selectedSummary.hidden=Boolean(row);intro.textContent=row?'Subscription status, payments and renewal settings for this customer.':'Search by name or email to choose the customer for this offer.';
  drawer.footer.replaceChildren();if(!groups.offer.hidden)drawer.footer.append(actionButtons.find(item=>item.label==='Offer subscription').button.parentElement);
  drawer.setTitle(row?.contactName||row?.email||'New subscription offer',row?row.email+' · '+row.plan+' · '+(row.billingStatus||'No subscription'):'Choose a customer and an eligible Commercial plan.','SUBSCRIPTIONS');
  requestId.parentElement.hidden=Boolean(row); title.textContent=row?'Subscription details':'New subscription offer';
  plan.value='';plan.dispatchEvent(new Event('change',{bubbles:true}));requestId.value=row?.id??'';requestId.dispatchEvent(new Event('change',{bubbles:true}));
  drawer.open(button,row?.id);
}
function openCoupon(row,button){
  recordVersion++;status.textContent='';
  currentCoupon=row;
  drawer.footer.replaceChildren(actionButtons.find(item=>item.label===(row?'Revoke coupon':'Generate coupon')).button.parentElement);
  drawer.setTitle(row?.code||'Create coupon',row?'Coupon '+row.id+' · '+row.status:'Set a plan, discount and redemption rules.','COUPONS');
  groups.create.hidden=Boolean(row);groups.revoke.hidden=!row;
  groups.revoke.open=Boolean(row); title.textContent=row?'Coupon details':'Create coupon'; intro.textContent=row?'Review this coupon’s redemption rules before taking an action.':'Create a private discount for a plan. No customer is charged.';discount.value=row?.id??'';discount.readOnly=Boolean(row);
  let context=panel.querySelector('.coupon-record-summary');if(context)context.remove();
  if(row){context=el('section',undefined,'coupon-record-summary detail-summary');for(const [label,value] of [['Discount',row.type==='percentage'?row.amount/100+'%':row.amount+' minor units'],['Redemptions',row.used+' / '+(row.usageLimit??'Unlimited')],['Plan',row.plans.join(', ')||(row.restricted?'Restricted products':'All eligible products')],['Expiry',row.expiresAt?new Date(row.expiresAt).toLocaleString():'No expiry']]){const line=el('div');line.append(el('small',label),el('strong',value));context.append(line);}title.after(context);}
  updateActions();drawer.open(button,row?.id);
}
async function refreshCoupons(reset=false){
  try{const result=await api('coupons?page='+(reset?1:couponPage+1));couponPage=result.page;couponRows=reset?result.coupons:[...couponRows,...result.coupons];grid.setRows(couponRows);loadMore.hidden=!result.hasMore;}catch(error){inbox.prepend(el('p',error.message,'workspace-error'));}
}
const loadMore=actionButton('Load more coupons',()=>refreshCoupons());

const panel = document.createElement('section'); panel.className = 'access-card billing-detail-card';
const title = document.createElement('h2'); title.textContent = isCoupons ? 'Create a coupon' : 'Choose a customer'; panel.append(title);
const status = document.createElement('p'); status.setAttribute('role', 'status');
async function api(path, value) {
  const version=recordVersion,scoped=value!==undefined||/^[a-f0-9]{64}\//.test(path);
  const response = await adminFetch(`/api/access-admin/billing/${path}`, { method: value === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store', headers: value === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  if(scoped&&version!==recordVersion)throw Error('The record context changed. Refresh the list to review the result.');
  if (!response.ok) throw Error(response.status === 404 ? 'Billing is disabled until Dodo account configuration is ready.' : 'Action failed. Check the request, plan, and operator session.');
  return response.json();
}
const form = document.createElement('form'); form.className = 'billing-workspace';
const intro = document.createElement('p'); intro.className = 'billing-intro';
intro.textContent = isCoupons ? 'Create a private discount for a plan. Existing subscriptions are unchanged until the code is redeemed.' : 'Select a customer to see their billing status and available actions. You are not searching Dodo or starting a charge here.';
panel.append(intro);
const selectedSummary = document.createElement('p'); selectedSummary.className = 'billing-note'; selectedSummary.setAttribute('aria-live', 'polite');
selectedSummary.textContent = 'Choose a customer to see their subscription details.';
let customers = [], billingReady = false, billingMode = null, availableOffers = [];
const actionButtons = [];

function field(label, name, type = 'text', value = '') {
  const wrapper = document.createElement('label'); wrapper.className = 'access-field'; wrapper.textContent = label;
  const input = document.createElement(['requestId', 'plan'].includes(name) ? 'select' : 'input'); input.name = name; if (input.tagName === 'INPUT') input.type = type; input.value = value;
  wrapper.append(input); form.append(wrapper);
  wrapper.hidden = isCoupons ? ['requestId', 'session'].includes(name) : ['basis', 'cycles', 'usage', 'expires', 'discount'].includes(name);
  return input;
}
const plan = field('Configured plan', 'plan');
const requestId = field('Customer', 'requestId');
const basis = field('Discount percentage (100 = free)', 'basis', 'number', '10');
const cycles = field('Number of discounted billing cycles', 'cycles', 'number', '12');
const usage = field('Maximum coupon redemptions', 'usage', 'number', '1');
const expires = field('Coupon expiry', 'expires', 'date');
const discount = field('Discount ID (for revoking a coupon)', 'discount');
plan.append(new Option('Billing is not configured', ''));
const session = field('Dodo checkout session ID (for recovering an interrupted checkout)', 'session');
function section(title, explanation, advanced = false) {
  const container = document.createElement(advanced ? 'details' : 'section'); container.className = 'billing-section';
  const heading = document.createElement(advanced ? 'summary' : 'h3'); heading.textContent = title;
  const note = document.createElement('p'); note.textContent = explanation;
  container.append(heading, note); form.append(container); return container;
}
const groups = {};
if (isCoupons) {
  groups.create = section('Discount details', 'Choose the plan, percentage, duration and redemption limit. Creating a coupon does not charge a customer.');
  for (const input of [plan, basis, cycles, usage, expires]) groups.create.append(input.parentElement);
  groups.revoke = section('Revoke a coupon', 'Stops future redemptions. Existing agreed subscription discounts remain unchanged.', true);
  groups.revoke.append(discount.parentElement);
} else {
  form.prepend(requestId.parentElement, selectedSummary);
  groups.offer = section('Subscription offers', 'Commercial subscription offers are created here. Personal customers subscribe through Manage. Creating an offer does not charge anyone; the customer must complete checkout.');
  groups.offer.append(plan.parentElement);
  groups.payments = section('Payment history', 'Read recorded payment events for the selected customer. This does not refresh or charge their subscription.');
  groups.reconcile = section('Reconcile subscription', 'Verify the selected order with Dodo and apply the current billing status. This does not start a checkout or charge the customer.');
  groups.recovery = section('Recover a checkout', 'Use only when checkout was interrupted. Paste the actual Dodo checkout session ID for this customer.', true);
  groups.recovery.append(session.parentElement);
  groups.renewal = section('Replace the server renewal key', 'Invalidates the server’s old renewal credential and downloads a replacement. The server operator must install the new file.', true);
  groups.health = section('Billing service status', 'Check the last scheduled billing sync and pending events. This checks the service, not a customer payment.', true);
}
const definitions = {
  'Check reconciliation': ['health', 'Check billing sync status'],
  'Offer subscription': ['offer', 'Create subscription offer'],
  'Rotate server renewal credential': ['renewal', 'Replace renewal key'],
  'Recover interrupted checkout': ['recovery', 'Recover checkout'],
  'Show payment history': ['payments', 'View payment history'],
  'Reconcile subscription': ['reconcile', 'Reconcile with Dodo'],
  'Generate coupon': ['create', 'Create coupon'],
  'Revoke coupon': ['revoke', 'Revoke coupon'],
};
function disabledReason(label) {
  if (!billingReady) return 'Billing configuration is unavailable.';
  if (isCoupons) {
    if (label === 'Revoke coupon') return /^[A-Za-z0-9_-]+$/.test(discount.value) ? '' : 'Enter the discount ID to revoke.';
    return plan.value && expires.value && [basis, cycles, usage].every(input => input.value !== '' && input.validity.valid) ? '' : 'Choose a plan and complete the discount details.';
  }
  return subscriptionActionReason({label, customer: customers.find(row => row.id === requestId.value), planId: plan.value, mode: billingMode, offerCount: availableOffers.length, sessionId: session.value});
}
function updateActions() {
  for (const {label,button,reason} of actionButtons) {
    const message = disabledReason(label); button.disabled = Boolean(message) || button.dataset.busy === 'true';
    reason.textContent = message; reason.hidden = !message;
  }
}
function action(label, work) {
  if (label === 'Show configured plans' || !groups[definitions[label]?.[0]]) return;
  const [group, display] = definitions[label];
  const wrap = document.createElement('div'); wrap.className = 'billing-action-block';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'button billing-action' + (['Offer subscription', 'Generate coupon'].includes(label) ? ' primary' : ['Revoke coupon','Rotate server renewal credential'].includes(label) ? ' danger' : ' secondary'); button.textContent = display;
  const reason = document.createElement('p'); reason.className = 'action-reason'; reason.id = 'reason-' + actionButtons.length;
  button.setAttribute('aria-describedby', reason.id);
  actionButtons.push({label,button,reason});
  button.addEventListener('click', async () => {
    if (disabledReason(label)) return;
    if (['Rotate server renewal credential','Revoke coupon','Offer subscription'].includes(label) && !await confirmOperation(display,groups[group].querySelector('p').textContent + (isCoupons?' Coupon: '+(currentCoupon?.code||discount.value)+' ('+discount.value+').':requestId.value?' Customer: '+(customers.find(row=>row.id===requestId.value)?.email||'')+'.'+(label==='Offer subscription'?' Plan: '+plan.selectedOptions[0].textContent+'.':''):''))) return;
    const version=recordVersion;button.dataset.busy = 'true'; updateActions();
    status.textContent = display + '…';
    try { await work(); if(isCoupons && ['Generate coupon','Revoke coupon'].includes(label)) {await refreshCoupons(true); if(label==='Revoke coupon')drawer.close();} } catch (error) { if(version===recordVersion)status.textContent = error.message; }
    finally { button.dataset.busy = 'false'; updateActions(); }
  });
  wrap.append(button,reason); groups[group].append(wrap); updateActions();
}
form.addEventListener('input', updateActions);
form.addEventListener('change', updateActions);
requestId.addEventListener('change', () => {
  const row = customers.find(row => row.id === requestId.value);
  if(row)drawer.setTitle((row.contactName||row.email)+(newOfferMode?' · New offer':''),row.email+' · '+row.plan+' · '+(row.billingStatus||'No subscription'),'SUBSCRIPTIONS');
  selectedSummary.textContent = row ? row.email + ' · ' + (row.billingStatus ? row.billingStatus + ' · ' + billingModeLabel(row) : row.plan+' customer · No current subscription') : 'Choose a customer to see their subscription details.';
});
action('Show configured plans', async () => { const result = await api('plans'); status.textContent = `${result.mode}: ${result.plans.map(p => `${p.id} (${p.maxUsers} users)`).join(', ')}`; });
action('Check reconciliation', async () => { const result = await api('health'); status.textContent = result.reconciliation
  ? `Last check: ${new Date(result.reconciliation.checked_at).toLocaleString()}. Checked: ${result.reconciliation.checked}. Failed: ${result.reconciliation.failed}. Pending events: ${result.pendingEvents}.`
  : 'Reconciliation has not run yet.'; });
action('Reconcile subscription', async () => {
  const id = requestId.value;
  const version = recordVersion;
  const result = await api(`${id}/reconcile`, {});
  const customer = customers.find(row => row.id === id);
  if (customer) {
    customer.billingStatus = result.status;
    customer.billingDetails = { ...customer.billingDetails, paidThrough: result.paidThrough };
    grid.setRows(customers);
  }
  if (version !== recordVersion) return;
  requestId.dispatchEvent(new Event('change'));
  status.textContent = result.accessReady && result.paidThrough
    ? `Access confirmed through ${new Date(result.paidThrough).toLocaleDateString()}.`
    : `Dodo status: ${result.status}. ${result.settlementReason ? 'Settlement: ' + result.settlementReason.replaceAll('_', ' ') + '.' : 'No access period confirmed.'}`;
});
action('Offer subscription', async () => {
  if (!/^[a-f0-9]{64}$/.test(requestId.value.trim())) throw Error('Choose an approved customer.');
  const result = await api(`${requestId.value.trim()}/offer`, { plan: plan.value.trim() });
  const url = URL.createObjectURL(new Blob([JSON.stringify({ refreshUrl: result.refreshUrl, refreshToken: result.refreshToken }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'subscription.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'Subscription offered. Securely give subscription.json to the server operator for automatic renewal. The existing private invitation now opens subscription management.';
});
action('Rotate server renewal credential', async () => {
  if (!/^[a-f0-9]{64}$/.test(requestId.value.trim())) throw Error('Choose an approved customer.');
  const result = await api(`${requestId.value.trim()}/rotate-refresh`, {});
  const url = URL.createObjectURL(new Blob([JSON.stringify({ refreshUrl: result.refreshUrl, refreshToken: result.refreshToken }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'subscription.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'The previous server renewal credential is invalid. Securely install the replacement subscription.json on this server.';
});
action('Recover interrupted checkout', async () => {
  if (!/^[a-f0-9]{64}$/.test(requestId.value.trim()) || !/^cks_[A-Za-z0-9]+$/.test(session.value.trim())) throw Error('Enter the request ID and actual Dodo checkout session ID.');
  const result = await api(`${requestId.value.trim()}/recover-checkout`, { sessionId: session.value.trim() }); status.textContent = `Recovered subscription: ${result.status}.`;
});
action('Show payment history', async () => {
  if (!/^[a-f0-9]{64}$/.test(requestId.value.trim())) throw Error('Choose an approved customer.');
  const result = await api(`${requestId.value.trim()}/payments`);
  let history=panel.querySelector('#subscription-payment-history');if(!history){history=el('div');history.id='subscription-payment-history';groups.payments.append(history);}history.replaceChildren();
  if(!result.events.length)history.append(el('p','No payment events recorded.','context-note'));
  else{const table=el('table',undefined,'record-history-table'),head=el('thead'),tr=el('tr');for(const label of ['Date','Event','Amount']){const th=el('th',label);th.scope='col';tr.append(th);}head.append(tr);const body=el('tbody');for(const event of result.events){const row=el('tr');for(const text of [new Date(event.at).toLocaleString(),event.type.replaceAll('.',' ').replaceAll('_',' '),event.amount===null?'—':formatMinorAmount(event.amount,event.currency)])row.append(el('td',text));body.append(row);}table.append(head,body);history.append(table);}status.textContent='Payment history loaded for the selected customer.';
});
action('Generate coupon', async () => {
  if (![basis, cycles, usage, expires].every(input => input.reportValidity()) || !expires.value || !plan.value) throw Error('Choose a plan and complete valid discount settings and expiry.');
  const result = await api('coupons', { plan: plan.value.trim(), basisPoints: Math.round(Number(basis.value) * 100), cycles: Number(cycles.value),
    usageLimit: Number(usage.value), expiresAt: `${expires.value}T23:59:59.000Z` });
  discount.value = result.discountId; status.textContent = `Coupon: ${result.code}. Discount ID: ${result.discountId}. Share the code privately.`;
});
action('Revoke coupon', async () => {
  if (!/^[A-Za-z0-9_-]+$/.test(discount.value)) throw Error('Enter the discount ID.');
  await api(`coupons/${discount.value}/revoke`, {}); status.textContent = 'Coupon revoked for future checkouts. Existing subscription discounts follow their agreed cycles.';
});
basis.min = '0.01'; basis.max = '100'; basis.step = '0.01'; cycles.min = '1'; cycles.max = '1200'; usage.min = '1'; usage.max = '10000';
form.addEventListener('submit', event => event.preventDefault());
status.setAttribute('aria-live', 'polite');
panel.append(form, status); drawer.body.append(panel);
adminReady.then(async ready => {
  if (!ready) return;
  if(isCoupons){
    pageActions()?.append(actionButton('Create coupon',button=>openCoupon(null,button),true));
    grid=createDataView(inbox,{title:'Loaded coupons',searchLabel:'Search loaded coupons by code or plan',searchText:r=>[r.code,...r.plans].join(' '),views:[{id:'all',label:'All coupons',test:()=>true},{id:'available',label:'Available',test:r=>r.status==='Available'},{id:'expired',label:'Expired',test:r=>r.status==='Expired'}],columns:[{key:'code',label:'Coupon',render:r=>identity(r.code,r.id)},{key:'amount',label:'Discount',render:r=>r.type==='percentage'?r.amount/100+'%':r.amount+' minor units'},{key:'status',label:'Status',render:r=>badge(r.status,r.status==='Available'?'success':'warning')},{key:'used',label:'Redemptions',render:r=>r.used+' / '+(r.usageLimit??'Unlimited')},{key:'expiresAt',label:'Expires',render:r=>r.expiresAt?new Date(r.expiresAt).toLocaleDateString():'No expiry'}],onOpen:openCoupon,toolbarActions:[actionButton('Refresh',()=>refreshCoupons(true)),loadMore]});
  }else{
    pageActions()?.append(actionButton('Service status',async button=>{serviceDrawer.setTitle('Billing service status','Scheduled sync and pending events. This does not charge customers.','BILLING OPERATIONS');serviceDrawer.body.textContent='Loading service status…';serviceDrawer.open(button);try{const result=await api('health');serviceDrawer.body.textContent=result.reconciliation?`Last check: ${new Date(result.reconciliation.checked_at).toLocaleString()}. Checked ${result.reconciliation.checked}, failed ${result.reconciliation.failed}. Pending events: ${result.pendingEvents}.`:'No billing sync has been recorded yet.';}catch(error){serviceDrawer.body.textContent=error.message;}}),actionButton('New subscription offer',button=>openBilling(null,button),true));
    grid=createDataView(inbox,{title:'Customers',defaultSort:{key:'email'},searchLabel:'Search subscriptions by customer name or email',searchText:r=>[r.email,r.contactName,r.plan,r.billingStatus].join(' '),views:[{id:'subscribed',label:'Subscriptions',test:r=>Boolean(r.billingStatus)},{id:'active',label:'Active',test:r=>r.billingStatus==='active'},{id:'attention',label:'Needs attention',test:r=>['failed','on_hold','past_due','checkout_pending'].includes(r.billingStatus)},{id:'unsubscribed',label:'No subscription',test:r=>!r.billingStatus}],columns:[{key:'email',label:'Customer',render:r=>identity(r.contactName||r.email,r.contactName?r.email:r.organization||'Individual customer')},{key:'plan',label:'Plan',render:r=>badge(r.plan)},{key:'billingStatus',label:'Subscription',render:r=>badge(r.billingStatus||'No subscription',r.billingStatus==='active'?'success':['failed','past_due','on_hold','checkout_pending'].includes(r.billingStatus)?'warning':'')},{key:'billingMode',label:'Billing mode',render:r=>r.billingStatus?billingModeLabel(r):'—'},{key:'paidThrough',label:'Paid through',value:r=>r.billingDetails?.paidThrough,render:r=>r.billingDetails?.paidThrough?new Date(r.billingDetails.paidThrough).toLocaleDateString():'—'}],onOpen:openBilling,toolbarActions:[actionButton('Refresh',async()=>{const data=await loadRequests(adminFetch);customers=data.requests.filter(r=>r.state==='approved');grid.setRows(customers);})]});
  }
  if (!isCoupons) {
    try {
      const result = await loadRequests(adminFetch); customers = result.requests.filter(r=>r.state==='approved'); grid.setRows(customers);
      const placeholder = new Option('Choose an approved customer', ''); requestId.append(placeholder);
      for (const row of result.requests.filter(row => row.state === 'approved')) {
        const option=new Option(row.contactName||row.email,row.id);option.disabled=['development','personal-purchase'].includes(row.kind)||Boolean(row.billingStatus&&!['cancelled','failed','expired'].includes(row.billingStatus));option.dataset.description=[row.email,row.plan,row.billingStatus||'No subscription',row.billingStatus?billingModeLabel(row):''].filter(Boolean).join(' · ');requestId.append(option);
      }
      enhanceSelect(requestId,{placeholder:'Find a customer by name or email…',describe:option=>option.dataset.description||''});
      if (requestId.options.length === 1) status.textContent = 'Approve an access request before offering a subscription.';
    } catch (error) { status.textContent = error.message; }
  }
  try {
    const result = await api('plans');
    billingMode = result.mode; availableOffers = result.plans.filter(item => item.plan === 'commercial');
    plan.replaceChildren(new Option(isCoupons || availableOffers.length ? 'Choose a plan' : 'No Commercial offer plans configured', ''));
    for (const item of (isCoupons ? result.plans : availableOffers)){const option=new Option(item.id.replaceAll('-',' '),item.id);option.dataset.description=`${item.maxUsers} users · ${item.plan} · ${result.mode==='live_mode'?'Live billing':'Test billing'}`;plan.append(option);}
    enhanceSelect(plan,{placeholder:'Search eligible plans…',describe:option=>option.dataset.description||''});
    const note = document.createElement('p'); note.className = 'billing-note';
    note.textContent = `${result.mode === 'live_mode' ? 'Live billing — real customer payments' : 'Test billing — no live payments'}. ${result.plans.map(p => `${p.id} (${p.maxUsers} users)`).join(', ')}`;
    document.querySelector('.workspace-page-header')?.after(note); billingReady = true; updateActions(); if(isCoupons)await refreshCoupons(true);
  } catch (error) {
    const note = document.createElement('p'); note.className = 'billing-note'; note.setAttribute('role', 'status'); note.textContent = error.message; inbox.prepend(note);
    billingReady = false; updateActions();
  }
}).catch(error => { status.textContent = error.message; });

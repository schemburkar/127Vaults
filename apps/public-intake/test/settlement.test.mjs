import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionSettlement, settledPersonalAccess } from '../cloudflare/settlement.mjs';
import { retrieveSettlement } from '../cloudflare/settlement-provider.mjs';
import { syncSubscription } from '../cloudflare/billing.mjs';
import { readFileSync } from 'node:fs';

const observed=JSON.parse(readFileSync(new URL('./fixtures/dodo-zero-observed.json',import.meta.url),'utf8'));
test('observed Dodo Test zero renewal confirms a distinct new service period',()=>{
  const renewal=JSON.parse(readFileSync(new URL('./fixtures/dodo-zero-renewal-observed.json',import.meta.url),'utf8'));
  assert.equal(renewal.payment.charge_type,'renewal');
  assert.equal(subscriptionSettlement(renewal).state,'settled_discounted');
  assert.notEqual(renewal.payment.created_at,observed.payment.created_at);
  const stale=structuredClone(renewal);stale.payment.service_periods=observed.payment.service_periods;
  assert.equal(subscriptionSettlement(stale).entitled,false);
});
test('observed Dodo Test zero checkout settles using authenticated legacy payment line items',()=>{
  assert.equal(subscriptionSettlement(observed).state,'settled_discounted');
  for(const mutate of [f=>delete f.lineItems,f=>f.lineItems.items[0].items_id='other',
    f=>f.payment.discounts[0].amount=9900,f=>f.payment.discounts=[],f=>f.subscription.recurring_pre_tax_amount=2000,
    f=>f.payment.tax=1,f=>f.lineItems.items[0].tax=1,f=>f.subscription.addons=[{}],
    f=>f.payment.customer.customer_id='other',f=>f.payment.service_periods[0].ends_at='2028-01-01T00:00:00Z']) {
    const f=structuredClone(observed);mutate(f);assert.equal(subscriptionSettlement(f).entitled,false);
  }
});

const now=Date.parse('2026-11-13T00:00:00Z'),start='2026-11-12T00:00:00.000Z',end='2027-11-12T00:00:00.000Z';
function fixture({zero=true}={}) {
  const metadata={order_id:'order-one',access_request_id:'request-one',billing_mode:'live_mode'};
  const order={mode:'live_mode',orderId:'order-one',productId:'pdt_one',sessionId:'cks_one',planSlug:'personal-annual'};
  const customer={customer_id:'cus_one',email:'buyer@example.invalid'};
  const subscription={subscription_id:'sub_one',metadata,product_id:'pdt_one',quantity:1,trial_period_days:0,
    status:'active',currency:'USD',customer,next_billing_date:end,previous_billing_date:start};
  const payment={payment_id:'pay_one',business_id:'biz_one',subscription_id:'sub_one',metadata,customer,
    status:'succeeded',total_amount:zero?0:2000,currency:'USD',created_at:start,checkout_session_id:'cks_one',charge_type:'new',
    product_cart:[{product_id:'pdt_one',quantity:1}],service_periods:[{subscription_id:'sub_one',starts_at:start,ends_at:end}],
    invoice_id:'inv_one',refunds:[],disputes:[],discounts:zero?[{discount_id:'dsc_one',business_id:'biz_one',type:'percentage',
      amount:10000,restricted_to:['pdt_one'],expires_at:'2026-10-01T00:00:00Z',cycles_remaining:0,subscription_cycles:1}]:[]};
  const invoice={invoice_id:'inv_one',business_id:'biz_one',customer,currency:'USD',subscription_ids:['sub_one'],
    status:'paid',total_amount:0,amount_due:0,amount_paid:0,credits:0,tax:0,amount_refunded:0,tags:[],discount_ids:['dsc_one'],
    lines:[{kind:'subscription',product_id:'pdt_one',subscription_id:'sub_one',quantity:1,unit_amount:2000,
      period_start:start,period_end:end}]};
  return {businessId:'biz_one',mode:'live_mode',order,requestId:'request-one',customerEmail:customer.email,subscription,payment,invoice,prices:{USD:2000},now};
}
const decide=change=>{const f=fixture();change?.(f);return subscriptionSettlement(f);};

test('normal positive and fully discounted settlements grant the same ordinary subscription period',()=>{
  const paid=subscriptionSettlement(fixture({zero:false})),free=decide();
  assert.equal(paid.state,'settled_paid');assert.equal(free.state,'settled_discounted');
  assert.equal(free.entitled,true);assert.equal(free.periodEnd,paid.periodEnd);assert.equal(free.amount,0);
  assert.equal(free.normalAmount,2000);assert.equal(free.discountAmount,2000);
  assert.equal(JSON.stringify(free).includes('buyer@'),false);
  assert.equal(JSON.stringify(free).includes('code'),false);
});

for(const [name,change] of [
  ['wrong environment',f=>f.mode='test_mode'],['wrong business',f=>f.payment.business_id='biz_other'],
  ['wrong order',f=>f.payment.metadata={...f.payment.metadata,order_id:'other'}],
  ['wrong request',f=>f.payment.metadata={...f.payment.metadata,access_request_id:'other'}],
  ['wrong customer',f=>f.payment.customer={customer_id:'cus_other'}],
  ['wrong customer email',f=>f.customerEmail='other@example.invalid'],
  ['wrong subscription',f=>f.payment.subscription_id='sub_other'],
  ['wrong product',f=>f.subscription.product_id='pdt_other'],
  ['wrong quantity',f=>f.subscription.quantity=2],['wrong currency',f=>f.payment.currency='EUR'],
  ['mixed subscription payment',f=>f.payment.is_multi_subscription=true],
  ['wrong checkout',f=>f.payment.checkout_session_id='cks_other'],
  ['wrong period',f=>f.payment.service_periods[0].ends_at='2027-12-01T00:00:00Z'],
  ['wrong invoice customer',f=>f.invoice.customer={customer_id:'cus_other'}],
  ['wrong invoice product',f=>f.invoice.lines[0].product_id='pdt_other'],
  ['another product discount',f=>f.payment.discounts[0].restricted_to=['pdt_other']],
  ['zero without discount',f=>f.payment.discounts=[]],['discount not applied to invoice',f=>f.invoice.discount_ids=[]],
  ['subscription-only attached discount',f=>{f.subscription.discounts=f.payment.discounts;f.payment.discounts=[];}],
  ['partial discount',f=>f.payment.discounts[0].amount=5000],['normal price missing',f=>f.prices={}],
  ['invoice missing',f=>delete f.invoice],['no payment object',f=>delete f.payment],
  ['invoice pending',f=>f.invoice.status='open'],['invoice balance outstanding',f=>f.invoice.amount_due=100],
  ['wallet credit instead of discount',f=>f.invoice.credits=2000],
  ['failed zero transaction',f=>f.payment.status='failed'],['unconfirmed transaction',f=>f.payment.status='processing'],
  ['trial',f=>f.subscription.trial_period_days=7],['mandate',f=>f.payment.is_update_payment_method=true],
  ['cancelled subscription',f=>f.subscription.status='cancelled'],['expired subscription',f=>f.subscription.status='expired'],
  ['refunded period',f=>f.payment.refunds=[{status:'succeeded',is_partial:false,amount:0}]],
  ['disputed period',f=>f.invoice.tags=['disputed']],['invalid amount',f=>f.payment.total_amount=NaN],
])test(`rejects or leaves pending: ${name}`,()=>assert.equal(decide(change).entitled,false));

test('coupon redemption expiry and zero remaining future cycles do not invalidate an applied settled period',()=>{
  assert.equal(decide().entitled,true);
  const next=fixture();next.payment.discounts=[];next.payment.charge_type='renewal';
  assert.equal(subscriptionSettlement(next).entitled,false);
  next.payment.total_amount=2000;assert.equal(subscriptionSettlement(next).state,'settled_paid');
});

test('stacked exact discounts and localized integer minor units reconcile without floating point guesses',()=>{
  const f=fixture();f.payment.currency=f.subscription.currency=f.invoice.currency='JPY';f.prices={JPY:3000};f.invoice.lines[0].unit_amount=3000;
  f.payment.discounts=[{...f.payment.discounts[0],amount:5000},{...f.payment.discounts[0],discount_id:'dsc_two',type:'flat',amount:1500}];
  f.invoice.discount_ids=['dsc_one','dsc_two'];assert.equal(subscriptionSettlement(f).entitled,true);
  f.prices.JPY=3001;f.invoice.lines[0].unit_amount=3001;assert.equal(subscriptionSettlement(f).reason,'discount_rounding_unconfirmed');
});

test('zero refunded arithmetic never suspends a settled zero invoice without an actual refund',()=>{
  assert.equal(decide(f=>{f.invoice.amount_refunded=0;f.payment.refunds=[];}).entitled,true);
});

test('access uses one bounded settlement and Test evidence cannot create production access',()=>{
  const f=fixture(),s=subscriptionSettlement(f);
  const record={kind:'personal-purchase',billing:{...f.order,subscriptionId:'sub_one',paidThrough:end,settlement:s}};
  assert.equal(settledPersonalAccess(record,now),true);
  record.billing.paidThrough='2028-01-01T00:00:00.000Z';assert.equal(settledPersonalAccess(record,now),false);
  record.billing.paidThrough=end;record.billing.mode=s.mode='test_mode';assert.equal(settledPersonalAccess(record,now),false);
});

function environment() {return {DODO_ENABLED:'1',DODO_MODE:'live_mode',DODO_BUSINESS_ID:'biz_one',DODO_API_KEY:'mock-only',DODO_WEBHOOK_SECRET:'mock-only',
  DODO_PLANS:JSON.stringify({'personal-annual':{productId:'pdt_one',plan:'personal',majorVersion:0,maxUsers:5,prices:{USD:2000}}})};}

test('legacy invoice 404 retrieves currency-bound payment line items through the provider adapter',async()=>{
  const f=structuredClone(observed),calls=[];
  const env={...environment(),DODO_MODE:'test_mode',DODO_BUSINESS_ID:f.businessId};
  const row={id:f.requestId,contact:{email:f.customerEmail},trial:{billing:f.order}};
  const provider=async url=>{const u=new URL(url);calls.push(u.pathname);
    if(u.pathname===`/payments/${f.payment.payment_id}`)return Response.json(f.payment);
    if(u.pathname.startsWith('/billing/invoices/'))return Response.json({message:'not found'},{status:404});
    if(u.pathname.endsWith('/line-items')){assert.equal(u.search,'');return Response.json(f.lineItems);}
    throw Error('Unexpected provider call '+u.pathname);
  };
  const result=await retrieveSettlement(env,row,f.subscription,{prices:f.prices},f.now,provider,f.payment);
  assert.equal(result.entitled,true);assert.equal(result.evidence,'payment_line_items');
  assert.equal(calls.length,3);
});

function localizedCheckout() {
  const f = fixture();
  delete f.invoice;
  delete f.prices;
  Object.assign(f.subscription, { recurring_pre_tax_amount: 2151, addons: [], meters: [] });
  Object.assign(f.payment, { currency: 'INR', tax: 0, settlement_currency: 'USD',
    settlement_amount: 0, settlement_tax: 0, product_cart: null });
  f.payment.discounts[0].position = 0;
  f.lineItems = { currency: 'USD', items: [{ items_id: 'pdt_one', amount: 0, tax: 0, refundable_amount: 0 }] };
  return f;
}

test('localized zero checkout verifies the current period without relying on the next renewal price', async () => {
  const f = localizedCheckout();
  const row = { id: f.requestId, contact: { email: f.customerEmail },
    trial: { kind: 'personal-purchase', billing: { ...f.order, status: 'checkout_pending' } } };
  const provider = async url => {
    const u = new URL(url);
    if (u.pathname === '/subscriptions/sub_one') return Response.json(f.subscription);
    if (u.pathname === '/payments/pay_one') return Response.json(f.payment);
    if (u.pathname === '/billing/invoices/inv_one') return new Response(null, { status: 404 });
    if (u.pathname === '/payments/pay_one/line-items' && !u.search) return Response.json(f.lineItems);
    throw Error('Unexpected provider request');
  };
  const store = { async save(row, next) { row.trial = next; } };
  await syncSubscription(environment(), store, row, () => assert.fail('Installation is not bound'), now,
    provider, f.subscription.subscription_id, f.payment);
  assert.equal(row.trial.billing.status, 'active');
  assert.equal(row.trial.billing.paidThrough, end);
  assert.equal(row.trial.billing.settlement.currency, 'INR');
  assert.equal(row.trial.billing.settlement.normalAmount, null);
  assert.equal(settledPersonalAccess(row.trial, now), true);
});

test('localized zero settlement fails closed without matching product, period, discount, tax and settlement evidence', () => {
  for (const mutate of [
    f => { f.payment.settlement_amount = 1; }, f => { f.payment.settlement_tax = 1; },
    f => { f.payment.tax = 1; }, f => { f.payment.settlement_currency = 'EUR'; },
    f => { delete f.subscription.currency; delete f.payment.settlement_currency; delete f.lineItems.currency; },
    f => { f.lineItems.currency = 'INR'; }, f => { f.lineItems.items[0].items_id = 'pdt_other'; },
    f => { f.payment.discounts[0].restricted_to = []; }, f => { f.payment.discounts[0].amount = 9999; },
    f => { f.payment.service_periods[0].ends_at = '2027-01-01T00:00:00Z'; },
    f => { f.payment.service_periods.push(f.payment.service_periods[0]); },
    f => { f.payment.total_amount = 1; }, f => { f.payment.refund_status = 'full'; },
  ]) {
    const f = localizedCheckout();
    mutate(f);
    assert.equal(subscriptionSettlement(f).entitled, false);
  }
});

test('reconciliation discovers a missed zero renewal and retrieves authenticated detail rather than list summaries',async()=>{
  const f=fixture();f.payment.charge_type='renewal';const calls=[];
  const row={id:f.requestId,contact:{email:f.customerEmail},trial:{kind:'personal-purchase',billing:{...f.order,subscriptionId:'sub_one'}}};
  const provider=async url=>{const u=new URL(url);calls.push(u.pathname);
    if(u.pathname==='/checkouts/cks_one')return Response.json({});
    if(u.pathname==='/payments')return Response.json({items:[{payment_id:'pay_one',total_amount:9999}]});
    if(u.pathname==='/payments/pay_one')return Response.json(f.payment);
    if(u.pathname==='/billing/invoices/inv_one')return Response.json(f.invoice);
    throw Error('Unexpected provider call '+u.pathname);};
  const result=await retrieveSettlement(environment(),row,f.subscription,{prices:f.prices},now,provider);
  assert.equal(result.state,'settled_discounted');assert.ok(calls.includes('/payments/pay_one'));
});

test('shared sync is idempotent and cannot extend a previous settlement into an unpaid next period',async()=>{
  const f=fixture(),env=environment();
  const row={id:f.requestId,contact:{email:f.customerEmail},trial:{kind:'personal-purchase',state:'approved',maxUsers:5,
    billing:{...f.order,subscriptionId:'sub_one'}}};
  let saves=0;
  const store={async save(row,next){saves++;row.trial=next;}};
  const provider=async url=>{const u=new URL(url);
    if(u.pathname==='/subscriptions/sub_one')return Response.json(f.subscription);
    if(u.pathname==='/checkouts/cks_one')return Response.json({payment_id:'pay_one'});
    if(u.pathname==='/payments/pay_one')return Response.json(f.payment);
    if(u.pathname==='/billing/invoices/inv_one')return Response.json(f.invoice);
    if(u.pathname==='/payments')return Response.json({items:[]});
    throw Error('Unexpected call '+u.pathname);};
  const release=()=>{throw Error('An unbound installation must not issue a license');};
  await syncSubscription(env,store,row,release,now,provider);
  await syncSubscription(env,store,row,release,now,provider);
  assert.equal(row.trial.billing.paidThrough,end);assert.equal(row.trial.billing.settlement.amount,0);assert.equal(saves,2);
  f.subscription.previous_billing_date=end;f.subscription.next_billing_date='2028-11-12T00:00:00Z';
  await syncSubscription(env,store,row,release,Date.parse(end)+86400000,provider);
  assert.equal(row.trial.billing.paidThrough,end);assert.equal(row.trial.billing.settlementCheck.reason,'payment_period_unconfirmed');
});

test('a fully discounted period issues the normal license once; renewal increments the same installation sequence',async()=>{
  const f=fixture(),env={...environment(),TRIAL_ISSUER_KEY_ID:'fixture-only'};
  const keys=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
  const row={id:f.requestId,contact:{email:f.customerEmail},trial:{kind:'personal-purchase',state:'approved',maxUsers:5,serverMajorVersion:0,
    installationId:'10000000-0000-4000-8000-000000000001',billing:{...f.order,subscriptionId:'sub_one'}}};
  const store={async save(row,next){row.trial=next;}};
  const payments=new Map([['pay_one',structuredClone(f.payment)]]);
  const provider=async url=>{const u=new URL(url);
    if(u.pathname==='/subscriptions/sub_one')return Response.json(f.subscription);
    if(u.pathname==='/checkouts/cks_one')return Response.json({payment_id:'pay_one'});
    if(u.pathname.startsWith('/payments/'))return Response.json(payments.get(u.pathname.slice('/payments/'.length)));
    if(u.pathname.startsWith('/billing/invoices/'))return Response.json(f.invoice);
    if(u.pathname==='/payments')return Response.json({items:[{payment_id:f.payment.payment_id}]});
    throw Error('Unexpected call '+u.pathname);};
  let issued=0;
  const release=async()=>{issued++;return {signingKey:keys.privateKey};};
  const license=()=>JSON.parse(Buffer.from(JSON.parse(row.trial.license).payload,'base64').toString());
  await syncSubscription(env,store,row,release,now,provider);
  assert.equal(license().plan,'personal');assert.equal(license().maxActiveUsers,5);assert.equal(license().sequence,1);
  assert.equal(license().installationId,row.trial.installationId);assert.equal(license().expiresAt,end);
  await syncSubscription(env,store,row,release,now,provider);
  assert.equal(issued,1);assert.equal(license().sequence,1);
  const nextEnd='2028-11-12T00:00:00.000Z',renewAt=Date.parse(end)+86400000;
  f.subscription.previous_billing_date=end;f.subscription.next_billing_date=nextEnd;
  f.payment={...f.payment,payment_id:'pay_two',invoice_id:'inv_two',charge_type:'renewal',created_at:end,
    service_periods:[{subscription_id:'sub_one',starts_at:end,ends_at:nextEnd}]};
  f.invoice={...f.invoice,invoice_id:'inv_two',lines:[{...f.invoice.lines[0],period_start:end,period_end:nextEnd}]};
  payments.set('pay_two',f.payment);
  await syncSubscription(env,store,row,release,renewAt,provider,undefined,f.payment);
  assert.equal(license().sequence,2);assert.equal(license().expiresAt,nextEnd);assert.equal(issued,2);
  await syncSubscription(env,store,row,release,renewAt,provider,undefined,f.payment);
  assert.equal(issued,2);
});

test('missed refund reconciliation persists denial and one revocation across cancellation timeouts',async()=>{
  const f=fixture(),env={...environment(),TRIAL_ISSUER_KEY_ID:'fixture-only'};
  const keys=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
  const row={id:f.requestId,contact:{email:f.customerEmail},trial:{kind:'personal-purchase',state:'approved',maxUsers:5,serverMajorVersion:0,
    installationId:'10000000-0000-4000-8000-000000000001',billing:{...f.order,subscriptionId:'sub_one'}}};
  const store={async save(row,next){row.trial=structuredClone(next);}};
  let cancellationFails=true,signingCalls=0,cancellations=0;
  const release=async()=>{signingCalls++;return {signingKey:keys.privateKey};};
  const provider=async(url,options)=>{const u=new URL(url);
    if(options.method==='PATCH'){cancellations++;return cancellationFails?new Response(null,{status:503}):Response.json({});}
    if(u.pathname==='/subscriptions/sub_one')return Response.json(f.subscription);
    if(u.pathname==='/checkouts/cks_one')return Response.json({payment_id:'pay_one'});
    if(u.pathname==='/payments/pay_one')return Response.json(f.payment);
    if(u.pathname==='/billing/invoices/inv_one')return Response.json(f.invoice);
    throw Error('Unexpected call '+u.pathname);};
  await syncSubscription(env,store,row,release,now,provider);
  assert.equal(signingCalls,1);
  f.payment.refunds=[{status:'succeeded',is_partial:false,amount:0}];
  await syncSubscription(env,store,row,release,now,provider);
  assert.equal(row.trial.billing.suspended,true);
  assert.equal(row.trial.billing.cancelPending,true);
  assert.equal(settledPersonalAccess(row.trial,now),false);
  const revocation=row.trial.billing.revocation;
  assert.ok(revocation);assert.equal(signingCalls,2);
  cancellationFails=false;
  await syncSubscription(env,store,row,release,now,provider);
  assert.equal(row.trial.billing.cancelPending,false);assert.equal(row.trial.billing.revocation,revocation);
  assert.equal(signingCalls,2);assert.equal(cancellations,2);
  await syncSubscription(env,store,row,release,now,provider);
  assert.equal(cancellations,2);
});

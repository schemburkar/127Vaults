// Explicit provider acceptance. Never imports the live credentials or writes to a live host.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { protectedDirectory } from './cloudflare/config.mjs';
const [action='inspect', configFile='.cloudflare-deploy/config.json'] = process.argv.slice(2);
if(!['prepare','inspect','renew','cancel'].includes(action))throw Error('Use prepare|inspect|renew|cancel [private config]');
const config=JSON.parse(await readFile(resolve(configFile),'utf8'));
const key=(await readFile(join(config.secretsDirectory,'dodo/test_mode/dodo-api-key'),'utf8')).trim();
if(key.startsWith('dodo_live_'))throw Error('Live credential refused');
const directory=resolve('.cloudflare-deploy/dodo-zero-acceptance');await protectedDirectory(directory);
const file=join(directory,'state.json');
let state=await readFile(file,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {mode:'test_mode',run:randomUUID(),productId:'pdt_0NrdRdE5yyH8PAZs9EigV'};throw error;});
const save=()=>writeFile(file,JSON.stringify(state,null,2),{mode:0o600});
async function api(path,method='GET',body) {
 const response=await fetch('https://test.dodopayments.com'+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),
  headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const text=await response.text();const value=text?JSON.parse(text):null;
 if(!response.ok){await writeFile(join(directory,'provider-error.json'),JSON.stringify({status:response.status,path,value}),{mode:0o600});throw Error(`Dodo Test ${method} ${path.split('/')[1]} failed (${response.status}); private diagnostic retained`);}
 return value;
}
if(action==='prepare') {
 const product=await api('/products/'+state.productId);
 state.normalPrice=product.price.price;state.currency=product.price.currency;
 if(!state.customerId){const customer=await api('/customers','POST',{email:`127vaults-${state.run}@example.invalid`,name:'127Vaults synthetic Test acceptance',metadata:{acceptance_run:state.run}});state.customerId=customer.customer_id;await save();}
 if(!state.discountId){const discount=await api('/discounts','POST',{type:'percentage',amount:10000,code:'T'+randomBytes(7).toString('hex').toUpperCase(),customer_eligibility:'specific',restricted_to:[state.productId],usage_limit:1,per_customer_usage_limit:1,metadata:{acceptance_run:state.run}});state.discountId=discount.discount_id;state.discountCode=discount.code;await save();}
 await api(`/discounts/${state.discountId}/customers`,'POST',{customer_ids:[state.customerId]});
 if(!state.checkoutId){state.metadata={access_request_id:randomBytes(32).toString('hex'),order_id:randomUUID(),billing_mode:'test_mode'};await save();
  const checkout=await api('/checkouts','POST',{product_cart:[{product_id:state.productId,quantity:1}],customer:{customer_id:state.customerId},
   billing_address:{country:'US',state:'OR',city:'Portland',street:'1 Test Street',zipcode:'97201'},billing_currency:'USD',
   discount_codes:[state.discountCode],subscription_data:{trial_period_days:0},metadata:state.metadata,confirm:true,
   feature_flags:{allow_customer_editing_email:false},return_url:'http://localhost:12961/'});
  state.checkoutId=checkout.session_id;state.checkoutUrl=checkout.checkout_url;state.paymentId=checkout.payment_id;await save();
 }
 console.log(JSON.stringify({mode:'test_mode',prepared:true,checkoutUrl:state.checkoutUrl,paymentCreated:!!state.paymentId}));
} else {
 if(!state.checkoutId)throw Error('Prepare the Test checkout first');
 if(action==='renew') {
  if(!state.subscriptionId || state.renewalScheduled)throw Error('Inspect first; renewal can be scheduled only once');
  state.renewalScheduled=new Date(Date.now()+60000).toISOString();
  await api('/subscriptions/'+state.subscriptionId,'PATCH',{next_billing_date:state.renewalScheduled});await save();
  console.log('Synthetic Test renewal scheduled');
 }
 const checkout=await api('/checkouts/'+state.checkoutId);
 state.paymentId=checkout.payment_id??state.paymentId;state.subscriptionId=checkout.subscription_id??state.subscriptionId;
 if(state.paymentId){const payment=await api('/payments/'+state.paymentId);state.subscriptionId=payment.subscription_id??state.subscriptionId;await writeFile(join(directory,'payment-private.json'),JSON.stringify(payment),{mode:0o600});
  await writeFile(join(directory,'line-items-private.json'),JSON.stringify(await api(`/payments/${state.paymentId}/line-items?currency=${payment.currency}`)),{mode:0o600});
  console.log(JSON.stringify({paymentStatus:payment.status,amount:payment.total_amount,hasInvoice:!!payment.invoice_id,servicePeriods:payment.service_periods?.length,discountCount:payment.discounts?.length}));
  if(payment.invoice_id){try{const invoice=await api('/billing/invoices/'+payment.invoice_id);await writeFile(join(directory,'invoice-private.json'),JSON.stringify(invoice),{mode:0o600});}catch(error){const diagnostic=JSON.parse(await readFile(join(directory,'provider-error.json'),'utf8'));if(diagnostic.status!==404)throw error;state.structuredInvoiceUnavailable=true;}}}
 if(state.subscriptionId){const subscription=await api('/subscriptions/'+state.subscriptionId);await writeFile(join(directory,'subscription-private.json'),JSON.stringify(subscription),{mode:0o600});console.log(JSON.stringify({subscriptionStatus:subscription.status,previousBillingDate:subscription.previous_billing_date,nextBillingDate:subscription.next_billing_date}));
  const page=await api('/payments?'+new URLSearchParams({subscription_id:state.subscriptionId,page_size:'20',page_number:'0'}));
  for(const candidate of page.items??[]) {
   const payment=await api('/payments/'+candidate.payment_id);
   if(!payment.service_periods?.some(p=>p.starts_at===subscription.previous_billing_date&&p.ends_at===subscription.next_billing_date))continue;
   const lineItems=await api(`/payments/${payment.payment_id}/line-items?currency=${payment.currency}`);
   const evidence={businessId:payment.business_id,mode:'test_mode',order:{mode:'test_mode',orderId:state.metadata.order_id,productId:state.productId,sessionId:state.checkoutId},requestId:state.metadata.access_request_id,customerEmail:payment.customer.email,subscription,payment,lineItems,prices:{[state.currency]:state.normalPrice},now:Date.now()};
   const {subscriptionSettlement}=await import('../apps/public-intake/cloudflare/settlement.mjs');
   const result=subscriptionSettlement(evidence);
   const phase=payment.charge_type==='renewal'?'renewal':'initial';
   if(action==='cancel')continue;
   await writeFile(join(directory,phase+'-evidence-private.json'),JSON.stringify(evidence),{mode:0o600});
   await writeFile(join(directory,phase+'-receipt.json'),JSON.stringify({phase,observedAt:new Date().toISOString(),mode:'test_mode',status:payment.status,amount:payment.total_amount,decision:result.state,entitled:result.entitled,periodStart:result.periodStart,periodEnd:result.periodEnd}),{mode:0o600});
   console.log(JSON.stringify({phase,decision:result.state,entitled:result.entitled}));
  }
  if(action==='cancel'){await api('/subscriptions/'+state.subscriptionId,'PATCH',{status:'cancelled'});await api('/discounts/'+state.discountId,'DELETE');console.log('Synthetic Test subscription cancelled and discount removed');}}
 await save();
}

import { dodo } from './dodo.mjs';
import { subscriptionSettlement } from './settlement.mjs';

// Every entry path (webhook, reconciliation, customer/license refresh) uses this
// adapter. It retrieves detail resources; payment list summaries are discovery only.
export async function retrieveSettlement(env,row,sub,plan,now,fetcher,eventPayment) {
  const b=row.trial.billing;
  const decision=(payment,invoice,lineItems)=>subscriptionSettlement({businessId:env.DODO_BUSINESS_ID,mode:env.DODO_MODE??'test_mode',
    order:b,requestId:row.id,customerEmail:row.contact.email,subscription:sub,payment,invoice,lineItems,prices:plan.prices,now});
  const seen=new Set();
  let last=decision();
  async function inspect(id) {
    if(!id || seen.has(id))return false;
    seen.add(id);
    const payment=await dodo(env,`/payments/${encodeURIComponent(id)}`,'GET',undefined,fetcher);
    if(payment.payment_id!==id)throw Error('Provider payment identity mismatch');
    let invoice,lineItems;
    if(payment.total_amount===0 && payment.status==='succeeded' && payment.invoice_id) {
      try {invoice=await dodo(env,`/billing/invoices/${encodeURIComponent(payment.invoice_id)}`,'GET',undefined,fetcher);}
      catch(error) {if(![404,422].includes(error.providerStatus))throw error;}
      if(!invoice)lineItems=await dodo(env,`/payments/${encodeURIComponent(id)}/line-items`,'GET',undefined,fetcher);
    }
    last=decision(payment,invoice,lineItems);
    return last.entitled || last.state==='suspended';
  }
  if(await inspect(eventPayment?.payment_id))return last;
  if(b.sessionId && !b.lastPayment) {
    const checkout=await dodo(env,`/checkouts/${encodeURIComponent(b.sessionId)}`,'GET',undefined,fetcher);
    if(await inspect(checkout.payment_id))return last;
  }
  if(await inspect(b.lastPayment?.id))return last;
  // Bounded discovery also repairs missed renewal webhooks. Incomplete discovery
  // remains pending; it cannot turn an old payment into a new service period.
  const query=new URLSearchParams({subscription_id:sub.subscription_id,customer_id:sub.customer.customer_id,
    product_id:b.productId,page_size:'20',page_number:'0',status:'succeeded'});
  const page=await dodo(env,`/payments?${query}`,'GET',undefined,fetcher);
  if(!Array.isArray(page.items))throw Error('Invalid provider payment listing');
  for(const candidate of page.items.slice(0,20))if(await inspect(candidate.payment_id))return last;
  return last;
}

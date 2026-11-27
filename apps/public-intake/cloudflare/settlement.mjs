// Pure decision over authenticated provider resources. Redirects and browser input
// never enter this function. See docs/architecture/discounted-settlement.md.
const instant = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const money = value => Number.isSafeInteger(value) && value >= 0;
const no = (state, reason) => ({ version:1, entitled:false, state, reason });
const sameBinding = (metadata, order, requestId, mode) => metadata?.order_id === order.orderId
  && metadata?.access_request_id === requestId && metadata?.billing_mode === mode;
const samePeriod = (start, end, subscription) => instant(start) !== null && instant(end) !== null
  && instant(start) === instant(subscription.previous_billing_date) && instant(end) === instant(subscription.next_billing_date);

export function subscriptionSettlement({ businessId, mode, order, requestId, subscription: sub, payment, invoice, lineItems, prices, now, customerEmail }) {
  if (order.mode !== mode || !['live_mode','test_mode'].includes(mode)) return no('rejected','environment_mismatch');
  if (!sameBinding(sub?.metadata,order,requestId,mode) || sub.product_id !== order.productId
    || (customerEmail && sub.customer?.email?.toLowerCase() !== customerEmail.toLowerCase())
    || sub.quantity !== 1 || !sub.customer?.customer_id
    || (order.subscriptionId && order.subscriptionId !== sub.subscription_id)
    || (order.customerId && order.customerId !== sub.customer.customer_id)) return no('rejected','subscription_binding');
  if (sub.trial_period_days !== 0 || sub.on_demand === true) return no('trial_or_mandate','not_normal_subscription');
  if (['cancelled','expired'].includes(sub.status)) return no(sub.status,'subscription_terminated');
  if (sub.status !== 'active') return no(sub.status === 'failed' ? 'failed' : 'pending','subscription_not_active');
  const end=instant(sub.next_billing_date), start=instant(sub.previous_billing_date);
  if (!end || !start || Date.parse(start)>now || Date.parse(end)<=now || Date.parse(start)>=Date.parse(end)
    || Date.parse(end)>now+370*86400000) return no('pending','period_unconfirmed');
  if (!payment) return no('pending','payment_evidence_unavailable');
  // Dodo can localize checkout while keeping the subscription and settlement
  // in the merchant currency. Only the fully discounted line-item path below
  // accepts that difference, and only when both currency amounts are zero.
  const localizedZero = !invoice && payment.currency !== sub.currency && payment.total_amount === 0
    && /^[A-Z]{3}$/.test(sub.currency ?? '') && payment.settlement_currency === sub.currency && payment.settlement_amount === 0
    && payment.settlement_tax === 0;
  if (!payment.payment_id || payment.business_id !== businessId || payment.subscription_id !== sub.subscription_id
    || payment.is_multi_subscription === true
    || (payment.subscription_ids && (payment.subscription_ids.length !== 1 || payment.subscription_ids[0] !== sub.subscription_id))
    || !sameBinding(payment.metadata,order,requestId,mode) || payment.customer?.customer_id !== sub.customer.customer_id
    || !/^[A-Z]{3}$/.test(payment.currency ?? '') || (payment.currency !== sub.currency && !localizedZero)
    || (order.currency && order.currency !== payment.currency)
    || (payment.product_cart && (payment.product_cart.length !== 1 || payment.product_cart[0].product_id !== order.productId
      || payment.product_cart[0].quantity !== 1))) return no('rejected','payment_binding');
  if (payment.is_update_payment_method === true || !['new','renewal'].includes(payment.charge_type)) return no('trial_or_mandate','not_period_charge');
  if (payment.charge_type === 'new' && (!order.sessionId || payment.checkout_session_id !== order.sessionId)) return no('rejected','checkout_binding');
  if (!payment.service_periods?.some(p=>p.subscription_id===sub.subscription_id && samePeriod(p.starts_at,p.ends_at,sub)))
    return no('pending','payment_period_unconfirmed');
  if (payment.refunds?.some(r=>r.status==='succeeded' && r.is_partial===false)) return no('suspended','payment_refunded');
  if (payment.disputes?.some(d=>!['dispute_won','dispute_cancelled'].includes(d.dispute_status))) return no('suspended','payment_disputed');
  if (payment.status !== 'succeeded') return no(['failed','cancelled'].includes(payment.status)?'failed':'pending','payment_not_settled');
  if (!money(payment.total_amount) || !instant(payment.created_at)) return no('pending','invalid_payment_amount');
  const result={version:1,entitled:true,state:'settled_paid',reason:'positive_payment',mode,subscriptionId:sub.subscription_id,
    paymentId:payment.payment_id,createdAt:instant(payment.created_at),amount:payment.total_amount,currency:payment.currency,
    periodStart:start,periodEnd:end,discounts:[]};
  if (payment.total_amount>0) return result;

  // A successful zero transaction still needs a settled invoice and applied
  // discount snapshots. Merely attaching a coupon to a subscription is insufficient.
  if (!invoice) {
    // Legacy subscription payments have a payment invoice ID but no resource in
    // /billing/invoices. Use authenticated payment line items, never manufacture
    // a paid invoice. Restrict this path to one fully discounted fixed product.
    const normal=prices?.[payment.currency], items=lineItems?.items, discounts=payment.discounts;
    const lineCurrency = localizedZero ? payment.settlement_currency : payment.currency;
    if (!payment.invoice_id || lineItems?.currency!==lineCurrency || items?.length!==1
      || items[0].items_id!==order.productId || items[0].amount!==0 || items[0].tax!==0
      || items[0].refundable_amount!==0 || payment.tax!==0
      || sub.addons?.length!==0 || sub.meters?.length!==0
      || (!localizedZero && (sub.recurring_pre_tax_amount!==0 || !money(normal) || normal===0)))
      return no('pending','zero_invoice_unavailable');
    // A single applied 100% percentage snapshot proves the complete discount
    // without relying on mutable coupon eligibility or unknown rounding rules.
    const d=discounts?.length===1?discounts[0]:null;
    if (!d || d.position!==0 || !d.discount_id || d.business_id!==businessId
      || d.type!=='percentage' || d.amount!==10000
      || (d.restricted_to?.length && !d.restricted_to.includes(order.productId))
      || (localizedZero && (!Array.isArray(d.restricted_to) || d.restricted_to.length !== 1
        || d.restricted_to[0] !== order.productId || payment.service_periods.length !== 1
        || payment.includes_usage === true || payment.refund_status != null)))
      return no('pending','full_discount_unconfirmed');
    return {...result,state:'settled_discounted',reason:'full_discount',evidence:'payment_line_items',
      invoiceId:payment.invoice_id,normalAmount:localizedZero ? null : normal,
      discountAmount:localizedZero ? null : normal,
      discounts:[{id:d.discount_id,type:d.type,amount:d.amount,subscriptionCycles:d.subscription_cycles??null,cyclesRemaining:d.cycles_remaining??null}]};
  }
  if (!payment.invoice_id || invoice.invoice_id!==payment.invoice_id || invoice.business_id!==businessId
    || invoice.customer?.customer_id!==sub.customer.customer_id || invoice.currency!==payment.currency
    || invoice.subscription_ids?.length!==1 || invoice.subscription_ids[0]!==sub.subscription_id)
    return no('rejected','invoice_binding');
  if (invoice.tags?.some(tag=>['refunded','partially_refunded','disputed','payment_reversed'].includes(tag))) return no('suspended','invoice_suspended');
  if (invoice.status!=='paid' || invoice.total_amount!==0 || invoice.amount_due!==0 || invoice.amount_paid!==0
    || invoice.credits!==0 || invoice.tax!==0 || invoice.amount_refunded!==0)
    return no('pending','zero_invoice_not_settled');
  const normal=prices?.[payment.currency];
  const line=invoice.lines?.length===1?invoice.lines[0]:null;
  if (!money(normal) || normal===0 || !line || line.kind!=='subscription' || line.product_id!==order.productId
    || line.subscription_id!==sub.subscription_id || line.quantity!==1 || line.unit_amount!==normal
    || !samePeriod(line.period_start,line.period_end,sub)) return no('pending','normal_price_unconfirmed');
  const discounts=payment.discounts;
  if (!Array.isArray(discounts) || !discounts.length || discounts.length>20 || invoice.discount_ids?.length!==discounts.length
    || new Set(discounts.map(d=>d.discount_id)).size!==discounts.length) return no('pending','discount_evidence_unavailable');
  let remaining=BigInt(normal);
  for (let index=0;index<discounts.length;index++) {
    const d=discounts[index];
    if (!d.discount_id || d.business_id!==businessId || !invoice.discount_ids.includes(d.discount_id)
      || (d.restricted_to?.length && !d.restricted_to.includes(order.productId)) || !money(d.amount)
      || !['percentage','flat'].includes(d.type)) return no('rejected','discount_binding');
    // Redemption expiry and cycles_remaining describe future use. The authenticated
    // payment/invoice snapshots prove application to this period, even at 0 left.
    if (d.type==='percentage') {
      if (d.amount>10000) return no('rejected','invalid_discount');
      const numerator=remaining*BigInt(10000-d.amount);
      if (numerator%10000n!==0n) return no('pending','discount_rounding_unconfirmed');
      remaining=numerator/10000n;
    } else remaining=remaining>BigInt(d.amount)?remaining-BigInt(d.amount):0n;
  }
  if (remaining!==0n) return no('pending','full_discount_unconfirmed');
  return {...result,state:'settled_discounted',reason:'full_discount',invoiceId:invoice.invoice_id,normalAmount:normal,
    discountAmount:normal,discounts:discounts.map(d=>({id:d.discount_id,type:d.type,amount:d.amount,
      subscriptionCycles:d.subscription_cycles??null,cyclesRemaining:d.cycles_remaining??null}))};
}

export function settledPersonalAccess(record,now) {
  const b=record?.billing,s=b?.settlement;
  if(record?.kind!=='personal-purchase'||b?.suspended||b?.mode!=='live_mode'
    || Date.parse(b.paidThrough)<=now || !Number.isFinite(Date.parse(b.paidThrough)))return false;
  if(s) return s.version===1 && s.entitled===true && ['settled_paid','settled_discounted'].includes(s.state)
    && s.mode===b.mode && s.subscriptionId===b.subscriptionId && s.periodEnd===b.paidThrough;
  // Previously issued positive-payment periods remain usable during migration.
  // This fallback never advances a period; sync writes the new decision first.
  return b.lastPayment?.status==='succeeded' && b.lastPayment.amount>0;
}

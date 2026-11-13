export function subscriptionActionReason({label, customer, planId, mode, offerCount, sessionId}) {
  if (label === 'Check reconciliation') return '';
  if (!customer) return 'Choose a customer first.';
  if (label === 'Offer subscription' && !offerCount) return 'No Commercial offer plan is configured. Personal customers subscribe through Manage.';
  if (label === 'Offer subscription' && ['development','personal-purchase'].includes(customer.kind)) return 'This request cannot receive an admin subscription offer. Personal customers subscribe through Manage.';
  if (label !== 'Show payment history' && customer.billingStatus && customer.billingMode !== mode) return 'This record belongs to another billing mode. Changes are unavailable in the current mode.';
  if (label === 'Offer subscription') return !planId ? 'Choose a plan.' : customer.billingStatus && !['cancelled','expired','failed'].includes(customer.billingStatus) ? 'This customer already has a subscription. Review its status first.' : '';
  if (!customer.billingStatus) return 'This customer has no subscription yet.';
  if (label === 'Recover interrupted checkout') return customer.billingStatus !== 'checkout_pending' ? 'Recovery is available only for an interrupted checkout.' : /^cks_[A-Za-z0-9]+$/.test(sessionId) ? '' : 'Enter the Dodo checkout session ID.';
  return '';
}

const plans = new Set(['personal', 'commercial']);
const emailPattern = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;

export function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['consent', 'email', 'organization', 'contactName', 'plan', 'website', 'requestedSeats'].includes(key))
    || ['consent', 'email', 'organization', 'plan', 'website'].some(key => !Object.hasOwn(value, key))) return null;
  const email = String(value.email ?? '').trim().toLowerCase();
  const organization = String(value.organization ?? '').trim();
  const contactName = typeof value.contactName === 'string' ? value.contactName.trim() : '';
  if (typeof value.email !== 'string' || !emailPattern.test(email) || email.length > 254
    || typeof value.organization !== 'string' || organization.length > 120
    || typeof value.website !== 'string' || value.website.length > 200
    || !plans.has(value.plan) || value.consent !== true
    || !Number.isSafeInteger(value.requestedSeats) || value.requestedSeats < 1 || value.requestedSeats > 100
    || (value.contactName !== undefined && typeof value.contactName !== 'string')
    || contactName.length > 120 || /[\x00-\x1f\x7f]/.test(contactName)
    || (value.plan === 'commercial' && (!organization || !contactName))) return null;
  return { email, organization, contactName: value.plan === 'commercial' ? contactName : null,
    plan: value.plan, requestedSeats: value.requestedSeats,
    trapped: value.website !== '' };
}

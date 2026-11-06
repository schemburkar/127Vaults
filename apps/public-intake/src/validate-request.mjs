const plans = new Set(['personal', 'commercial']);
const emailPattern = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;

export function validateRequest(value) {
  if (value?.plan === 'support') {
    const { email, contactName, message, website, consent } = value;
    if (Object.keys(value).some(key => !['plan', 'email', 'contactName', 'message', 'website', 'consent'].includes(key))
      || typeof email !== 'string' || email.trim().length > 254 || !emailPattern.test(email.trim())
      || typeof contactName !== 'string' || !contactName.trim() || contactName.length > 120 || /[\x00-\x1f\x7f]/.test(contactName)
      || typeof message !== 'string' || !message.trim() || message.length > 300 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message)
      || typeof website !== 'string' || website.length > 200 || consent !== true) return null;
    return { plan: 'support', email: email.trim().toLowerCase(), contactName: contactName.trim(),
      message: message.trim(), trapped: website !== '' };
  }
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
  return { email, organization, contactName: contactName || null,
    plan: value.plan, requestedSeats: value.requestedSeats,
    trapped: value.website !== '' };
}

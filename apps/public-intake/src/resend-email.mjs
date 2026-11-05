const email = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
const purposes = new Set(['signup', 'sign-in', 'invitation', 'license', 'access']);
export function productionRecipient(value) {
  if (!email.test(value ?? '')) return false;
  const domain = value.split('@')[1].toLowerCase();
  return !/(^|\.)(example\.(com|net|org)|resend\.dev)$/.test(domain)
    && !/(^|\.)(localhost|invalid|test|example)$/.test(domain);
}
export function createResendCustomerMailer({ apiKey, from, deliveryMode, fetchImpl = fetch }) {
  if (deliveryMode !== 'production' || !/^re_[A-Za-z0-9_-]{16,200}$/.test(apiKey ?? '') || !email.test(from ?? '')) throw Error('Production customer email is not configured');
  return { async sendInvitation({ to, subject, text, purpose, idempotencyKey, audience }) {
    if (audience !== 'customer' || !purposes.has(purpose) || !productionRecipient(to)
      || typeof subject !== 'string' || !subject.length || subject.length > 200 || /[\r\n]/.test(subject)
      || typeof text !== 'string' || !text.length || text.length > 12000
      || !/^[a-z0-9-]{1,30}\/[a-f0-9]{64}$/.test(idempotencyKey ?? '')) throw Error('Invalid production customer email');
    const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ from: `127Vaults <${from}>`, to: [to], subject, text }),
      redirect: 'manual', signal: AbortSignal.timeout(15000) });
    // No redirects, provider error bodies, email contents, keys or codes enter logs.
    if (!response.ok || response.status >= 300) throw Error('Customer email submission was not confirmed');
    const result = await response.json();
    if (typeof result.id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(result.id)) throw Error('Customer email submission was not confirmed');
    return { state: 'queued', providerId: result.id };
  } };
}

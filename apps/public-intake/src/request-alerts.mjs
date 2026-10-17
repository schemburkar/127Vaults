// Fixed-recipient operator alerts. Never sends an invitation or activation token.
export function requestAlertsEnabled(env) {
  const email = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
  return typeof env.REQUEST_ALERTS?.send === 'function' && email.test(env.REQUEST_ALERT_TO ?? '')
    && email.test(env.REQUEST_ALERT_FROM ?? '')
    && env.REQUEST_ALERT_FROM.split('@')[1].toLowerCase() === new URL(env.PUBLIC_INTAKE_ORIGIN).hostname;
}
export async function notifyNewAccessRequest(env, store, id, contact, at) {
  if (!requestAlertsEnabled(env)) return;
  let row = await store.get(id);
  if (!row?.contact || row.trial?.requestAlertAttemptedAt) return;
  const attempt = crypto.randomUUID();
  await store.save(row, { state: 'requested', ...row.trial, requestAlertAttempt: attempt,
    requestAlertAttemptedAt: new Date(at).toISOString(), requestAlertState: 'sending' });
  let state = 'unconfirmed', timer;
  try {
    const result = await Promise.race([env.REQUEST_ALERTS.send({ from: env.REQUEST_ALERT_FROM, to: env.REQUEST_ALERT_TO,
      subject: 'New 127Vaults access request', text: [
        'A new public access request is waiting for review.', '',
        `Email: ${contact.email}`, `Name: ${contact.contactName || 'Not supplied'}`,
        `Organization: ${contact.organization || 'Not supplied'}`, `Plan: ${contact.plan}`,
        `Requested users: ${contact.requestedSeats ?? 'Not supplied'}`, `Received: ${new Date(at).toISOString()}`, '',
        `Review: ${env.PUBLIC_INTAKE_ORIGIN}/access-admin`,
        'Open the access desk and sign in with your operator key. This email does not approve the request.',
      ].join('\n') }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('alert deadline')), 15000); })]);
    if (typeof result?.messageId === 'string' && result.messageId) state = 'accepted';
  } catch { /* Ambiguous submissions are recorded, never automatically resent. */ }
  finally { clearTimeout(timer); }
  row = await store.get(id);
  if (row?.contact && row.trial?.requestAlertAttempt === attempt) {
    await store.save(row, { ...row.trial, requestAlertState: state });
  }
}

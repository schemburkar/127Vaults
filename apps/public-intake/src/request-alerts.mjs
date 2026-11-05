// Fixed-recipient operator alerts. Never sends an invitation or activation token.
export function requestAlertsEnabled(env) {
  const email = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
  return typeof env.REQUEST_ALERTS?.send === 'function' && email.test(env.REQUEST_ALERT_TO ?? '')
    && email.test(env.REQUEST_ALERT_FROM ?? '')
    && env.REQUEST_ALERT_FROM.split('@')[1].toLowerCase() === new URL(env.PUBLIC_SITE_ORIGIN ?? env.PUBLIC_INTAKE_ORIGIN).hostname;
}
export async function notifyNewAccessRequest(env, store, id, contact, at, { replacement = false } = {}) {
  if (!requestAlertsEnabled(env)) return;
  let row = await store.get(id);
  const prefix = replacement ? 'replacementAlert' : 'requestAlert';
  if (!row?.contact || row.trial?.[prefix + 'AttemptedAt'] || (replacement && !row.trial?.replacementRequest)) return;
  const attempt = crypto.randomUUID();
  await store.save(row, { state: 'requested', ...row.trial, [prefix + 'Attempt']: attempt,
    [prefix + 'AttemptedAt']: new Date(at).toISOString(), [prefix + 'State']: 'sending' });
  let state = 'unconfirmed', timer;
  try {
    const result = await Promise.race([env.REQUEST_ALERTS.send({ from: env.REQUEST_ALERT_FROM, to: env.REQUEST_ALERT_TO,
      subject: replacement ? '127Vaults replacement license requested' : 'New 127Vaults access request', text: [
        replacement ? 'An existing customer requested a replacement installation license. Review and issue it without extending the original expiry.' : 'A new public access request is waiting for review.', '',
        `Email: ${contact.email}`, `Name: ${contact.contactName || 'Not supplied'}`,
        `Organization: ${contact.organization || 'Not supplied'}`, `Plan: ${contact.plan}`,
        `Requested users: ${contact.requestedSeats ?? 'Not supplied'}`, `Received: ${new Date(at).toISOString()}`, '',
        `Review this request: ${env.ADMIN_ORIGIN ?? env.PUBLIC_INTAKE_ORIGIN}/access-admin?request=${encodeURIComponent(id)}`,
        `Request reference: ${id}`,
        'Sign in to Admin to review this specific request. Opening this link does not approve or change anything.',
        'Approval issues a private invitation; the customer is emailed automatically when customer email is enabled.',
      ].join('\n') }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('alert deadline')), 15000); })]);
    if (typeof result?.messageId === 'string' && result.messageId) state = 'accepted';
  } catch { /* Ambiguous submissions are recorded, never automatically resent. */ }
  finally { clearTimeout(timer); }
  row = await store.get(id);
  if (row?.contact && row.trial?.[prefix + 'Attempt'] === attempt) {
    await store.save(row, { ...row.trial, [prefix + 'State']: state });
  }
}

// Operational threshold lives only in private deployment settings, never public assets or responses.
export async function notifyRequestVolume(env, store, at) {
  if (env.INTAKE_PROTECTION !== '1' || !requestAlertsEnabled(env)) return;
  const threshold = Number(env.INTAKE_VOLUME_THRESHOLD), window = Number(env.INTAKE_VOLUME_WINDOW_MS);
  if (!Number.isSafeInteger(threshold) || threshold < 2 || !Number.isSafeInteger(window) || window < 3600000) return;
  const { total } = await store.db.prepare('SELECT count(DISTINCT email_hash) AS total FROM intake_activity WHERE received_at > ? AND received_at <= ?').bind(at - window, at).first();
  if (total < threshold) return;
  const claimed = await store.db.prepare(`INSERT INTO intake_volume_alerts (id, attempted_at, state) VALUES ('volume', ?, 'sending')
    ON CONFLICT(id) DO UPDATE SET attempted_at = excluded.attempted_at, state = 'sending'
    WHERE intake_volume_alerts.attempted_at <= ? RETURNING id`).bind(at, at - window).first();
  if (!claimed) return;
  let state = 'unconfirmed', timer;
  try {
    const result = await Promise.race([env.REQUEST_ALERTS.send({ from: env.REQUEST_ALERT_FROM, to: env.REQUEST_ALERT_TO,
      subject: '127Vaults request volume is higher than usual',
      text: `Your website received access requests from ${total} distinct email addresses in the last ${window / 3600000} hours. This may be interest from new visitors or attempted abuse; it does not establish either.\n\nReview the request timestamps, names and organizations before approving. Customer email budgets and request protections remain active. No access was automatically approved.\n\nOpen the private access desk: ${env.ADMIN_ORIGIN ?? env.PUBLIC_INTAKE_ORIGIN}/access-admin\n\nThis alert is limited to one attempt per monitoring window, including uncertain send results.` }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('alert deadline')), 15000); })]);
    if (result?.messageId) state = 'accepted';
  } catch { /* Never repeat an uncertain alert automatically. */ }
  finally { clearTimeout(timer); }
  await store.db.prepare("UPDATE intake_volume_alerts SET state = ? WHERE id = 'volume' AND attempted_at = ?").bind(state, at).run();
}

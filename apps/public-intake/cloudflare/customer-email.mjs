import { encryptionKey, hash, seal } from './crypto.mjs';
import { createResendCustomerMailer, productionRecipient } from '../src/resend-email.mjs';

const day = 86400000;
export function resendCustomerEmailEnabled(env) {
  return env.CUSTOMER_EMAIL_PROVIDER === 'resend' && env.CUSTOMER_EMAIL_MODE === 'production'
    && env.LOCAL_SITE_PREVIEW !== '1' && ['admin', 'customer'].includes(env.SITE_SURFACE)
    && /^re_[A-Za-z0-9_-]{16,200}$/.test(env.RESEND_API_KEY ?? '') && Boolean(env.CUSTOMER_EMAIL_FROM);
}
// Durable, encrypted receipts prevent duplicate sends across Workers and retries.
// Unknown outcomes are retained for review; there is no background resend loop.
export async function sendCustomerEmail(env, store, { requestId, event, purpose, message, recordKind, expiresAt },
  { now = Date.now(), fetchImpl = fetch } = {}) {
  if (!resendCustomerEmailEnabled(env) || recordKind === 'development' || !productionRecipient(message.to)) return { state: 'suppressed' };
  if (!/^[a-f0-9]{64}$/.test(requestId ?? '') || typeof event !== 'string' || event.length > 300) throw Error('Invalid customer notification');
  const id = await hash(`${purpose}\0${requestId}\0${event}`), until = expiresAt ?? now + 90 * day;
  const row = await store.get(requestId);
  if (!row?.contact || row.contact.email.toLowerCase() !== message.to.toLowerCase() || row.trial?.kind === 'development') return { state: 'suppressed' };
  if (purpose === 'invitation' && row.trial?.state !== 'approved') return { state: 'suppressed' };
  const key = await encryptionKey(env.INTAKE_KEY, 'customer-email');
  const claimed = await store.db.prepare(`INSERT INTO customer_email_receipts (id, request_id, purpose, state, payload, expires_at)
    VALUES (?, ?, ?, 'claimed', ?, ?) ON CONFLICT(id) DO NOTHING RETURNING id`)
    .bind(id, requestId, purpose, await seal(message, key, `customer-email:${id}`), until).first();
  if (!claimed) return { state: 'already_attempted' };
  const update = (state, providerId = null) => store.db.prepare('UPDATE customer_email_receipts SET state = ?, provider_id = ? WHERE id = ?').bind(state, providerId, id).run();
  const daily = Number(env.CUSTOMER_EMAIL_DAILY_LIMIT ?? 90), monthly = Number(env.CUSTOMER_EMAIL_MONTHLY_LIMIT ?? 2800);
  if (!Number.isSafeInteger(daily) || daily < 21 || daily > 90 || !Number.isSafeInteger(monthly) || monthly < 1 || monthly > 2800) throw Error('Invalid customer email budget');
  const date = new Date(now).toISOString();
  const reserve = async (window, maximum, expiry) => Boolean(await store.db.prepare(`INSERT INTO customer_email_budget (window, used, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(window) DO UPDATE SET used = used + 1 WHERE used < ? RETURNING used`).bind(window, expiry, maximum).first());
  // Non-authentication email cannot consume the final 20 daily slots reserved for sign-in.
  const available = (purpose === 'sign-in' || await reserve(`notice:${date.slice(0, 10)}`, Math.max(1, daily - 20), now + 2 * day))
    && await reserve(`day:${date.slice(0, 10)}`, daily, now + 2 * day)
    && await reserve(`month:${date.slice(0, 7)}`, monthly, now + 40 * day);
  if (!available) { await update('limited'); return { state: 'limited' }; }
  if (until <= now) { await update('expired'); return { state: 'expired' }; }
  try {
    const mailer = createResendCustomerMailer({ apiKey: env.RESEND_API_KEY, from: env.CUSTOMER_EMAIL_FROM, deliveryMode: 'production', fetchImpl });
    const result = await mailer.sendInvitation({ ...message, audience: 'customer', purpose, idempotencyKey: `${purpose}/${id}` });
    await update(result.state, result.providerId); return result;
  } catch { await update('unconfirmed'); return { state: 'unconfirmed' }; }
}
export async function pruneCustomerEmail(env, store, now) {
  if (env.CUSTOMER_EMAIL_STORAGE !== '1' && env.CUSTOMER_EMAIL_PROVIDER !== 'resend') return;
  await store.db.batch([
    store.db.prepare('DELETE FROM customer_email_receipts WHERE expires_at <= ? OR request_id IN (SELECT id FROM access_requests WHERE contact IS NULL)').bind(now),
    store.db.prepare('DELETE FROM customer_email_budget WHERE expires_at <= ?').bind(now),
  ]);
}

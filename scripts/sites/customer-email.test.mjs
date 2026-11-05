import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalSites } from './local.mjs';
import { sendCustomerEmail, resendCustomerEmailEnabled, pruneCustomerEmail } from '../../apps/public-intake/cloudflare/customer-email.mjs';

const env = { CUSTOMER_EMAIL_PROVIDER: 'resend', CUSTOMER_EMAIL_MODE: 'production', SITE_SURFACE: 'customer',
  CUSTOMER_EMAIL_FROM: 'accounts@127vaults.com', RESEND_API_KEY: 're_' + 'fake'.repeat(8), INTAKE_KEY: 'a'.repeat(64) };
const requestId = 'a'.repeat(64), to = 'customer@customer-domain.dev';
const notice = { requestId, event: 'first', purpose: 'signup', message: { to, subject: 'Access request', text: 'Only synthetic customer content' } };
test('internal, development, local and reserved-recipient mail is suppressed before storage or transport', async () => {
  const forbidden = async () => { throw Error('Transport must not run'); };
  for (const change of [{ CUSTOMER_EMAIL_MODE: 'capture' }, { CUSTOMER_EMAIL_MODE: 'disabled' }, { LOCAL_SITE_PREVIEW: '1' }, { SITE_SURFACE: 'public' }, { SITE_SURFACE: 'intake' }, { RESEND_API_KEY: undefined }]) {
    assert.equal(resendCustomerEmailEnabled({ ...env, ...change }), false);
    assert.equal((await sendCustomerEmail({ ...env, ...change }, null, notice, { fetchImpl: forbidden })).state, 'suppressed');
  }
  assert.equal((await sendCustomerEmail(env, null, { ...notice, recordKind: 'development' }, { fetchImpl: forbidden })).state, 'suppressed');
  assert.equal((await sendCustomerEmail(env, null, { ...notice, message: { ...notice.message, to: 'test@example.com' } }, { fetchImpl: forbidden })).state, 'suppressed');
});
test('encrypted durable claims deduplicate concurrent customer notifications and retain ambiguous outcomes without resending', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-customer-email-')); const local = await createLocalSites({ directory });
  t.after(async () => { await local.close(); await rm(directory, { recursive: true, force: true }); });
  const row = { id: requestId, contact: { email: to }, trial: { kind: 'trial' } };
  const store = { db: local.database, get: async id => id === requestId ? row : null };
  let calls = 0;
  const transport = async () => { calls++; return Response.json({ id: `local-${calls}` }); };
  const results = await Promise.all(Array.from({ length: 5 }, () => sendCustomerEmail(env, store, notice, { fetchImpl: transport })));
  assert.equal(calls, 1); assert.equal(results.filter(result => result.state === 'queued').length, 1);
  const stored = await local.database.prepare('SELECT payload, state FROM customer_email_receipts').first();
  assert.equal(stored.state, 'queued'); assert.ok(!stored.payload.includes(to)); assert.ok(!stored.payload.includes(notice.message.text));
  const failed = { ...notice, event: 'lost-reply' };
  assert.equal((await sendCustomerEmail(env, store, failed, { fetchImpl: async () => { calls++; throw Error('uncertain'); } })).state, 'unconfirmed');
  assert.equal((await sendCustomerEmail(env, store, failed, { fetchImpl: transport })).state, 'already_attempted');
  assert.equal(calls, 2);
  row.trial.kind = 'development';
  assert.equal((await sendCustomerEmail(env, store, { ...notice, event: 'development' }, { fetchImpl: transport })).state, 'suppressed');
  assert.equal(calls, 2);
});
test('daily budget reserves sign-in capacity and monthly limits never leak into a real provider call', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-email-budget-')); const local = await createLocalSites({ directory });
  t.after(async () => { await local.close(); await rm(directory, { recursive: true, force: true }); });
  const store = { db: local.database, get: async () => ({ id: requestId, contact: { email: to }, trial: {} }) };
  let calls = 0; const transport = async () => { calls++; return Response.json({ id: `fake-${calls}` }); };
  const settings = { ...env, CUSTOMER_EMAIL_DAILY_LIMIT: '21', CUSTOMER_EMAIL_MONTHLY_LIMIT: '30' };
  const now = Date.UTC(2026, 10, 5);
  assert.equal((await sendCustomerEmail(settings, store, notice, { fetchImpl: transport, now })).state, 'queued');
  assert.equal((await sendCustomerEmail(settings, store, { ...notice, event: 'second' }, { fetchImpl: transport, now })).state, 'limited');
  for (let n = 0; n < 20; n++) assert.equal((await sendCustomerEmail(settings, store, { ...notice, purpose: 'sign-in', event: `code-${n}` }, { fetchImpl: transport, now })).state, 'queued');
  assert.equal((await sendCustomerEmail(settings, store, { ...notice, purpose: 'sign-in', event: 'over-budget' }, { fetchImpl: transport, now })).state, 'limited');
  assert.equal(calls, 21);
  for (let n = 0; n < 9; n++) assert.equal((await sendCustomerEmail(settings, store, { ...notice, purpose: 'sign-in', event: `next-day-${n}` }, { fetchImpl: transport, now: now + 86400000 })).state, 'queued');
  assert.equal((await sendCustomerEmail(settings, store, { ...notice, purpose: 'sign-in', event: 'over-monthly-budget' }, { fetchImpl: transport, now: now + 86400000 })).state, 'limited');
  assert.equal(calls, 30);
  await pruneCustomerEmail(settings, store, now + 100 * 86400000);
  assert.equal((await local.database.prepare('SELECT count(*) AS n FROM customer_email_receipts').first()).n, 0);
});

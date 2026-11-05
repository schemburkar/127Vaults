import test from 'node:test';
import assert from 'node:assert/strict';
import { createResendCustomerMailer, productionRecipient } from '../src/resend-email.mjs';

// Every transport in this file is an in-memory fake, never Resend's test API.
const message = { to: 'customer@customer-domain.dev', subject: 'Your access', text: 'Customer message', audience: 'customer', purpose: 'invitation', idempotencyKey: 'invitation/' + 'a'.repeat(64) };
test('Resend adapter uses the fixed endpoint, explicit production mode and idempotency without redirects', async () => {
  let calls = 0;
  const mailer = createResendCustomerMailer({ apiKey: 're_' + 'fake'.repeat(8), from: 'accounts@127vaults.com', deliveryMode: 'production', fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.resend.com/emails'); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers['Idempotency-Key'], message.idempotencyKey);
    assert.deepEqual(JSON.parse(options.body), { from: '127Vaults <accounts@127vaults.com>', to: [message.to], subject: message.subject, text: message.text });
    return Response.json({ id: 'local-fake-message' });
  } });
  assert.deepEqual(await mailer.sendInvitation(message), { state: 'queued', providerId: 'local-fake-message' });
  assert.equal(calls, 1);
  for (const changed of [{ audience: 'internal' }, { purpose: 'test' }, { to: 'test@resend.dev' }, { to: 'test@example.com' }, { subject: 'Hello\r\nBcc: other@customer-domain.dev' }, { idempotencyKey: '' }]) await assert.rejects(mailer.sendInvitation({ ...message, ...changed }));
  assert.equal(calls, 1);
});
test('capture, disabled and unconfigured mail cannot construct a real provider sender', () => {
  for (const deliveryMode of [undefined, 'capture', 'disabled', 'test']) assert.throws(() => createResendCustomerMailer({ apiKey: 're_' + 'fake'.repeat(8), from: 'accounts@127vaults.com', deliveryMode }));
  for (const address of ['a@example.org', 'a@sub.example.com', 'a@localhost', 'a@fixture.invalid', 'a@fixture.test', 'a@resend.dev']) assert.equal(productionRecipient(address), false);
});
test('redirects, provider errors and malformed acknowledgements never claim queued delivery', async () => {
  for (const response of [new Response(null, { status: 302, headers: { Location: 'https://elsewhere.invalid' } }), Response.json({ message: 'private-provider-detail' }, { status: 429 }), Response.json({})]) {
    const mailer = createResendCustomerMailer({ apiKey: 're_' + 'fake'.repeat(8), from: 'accounts@127vaults.com', deliveryMode: 'production', fetchImpl: async () => response });
    await assert.rejects(mailer.sendInvitation(message), error => !error.message.includes('private-provider-detail'));
  }
});

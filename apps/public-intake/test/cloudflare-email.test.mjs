import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareTrialMailer } from '../src/cloudflare-email.mjs';

test('Cloudflare adapter sends only the fixed server sender and classifies actual REST recipient results', async () => {
  let result;
  const mailer = createCloudflareTrialMailer({ accountId: 'a'.repeat(32), apiToken: 'synthetic-token-for-local-tests', from: 'trials@example.com',
    fetchImpl: async (url, options) => {
      assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/email/sending/send`);
      assert.equal(options.redirect, 'error'); assert.ok(options.signal);
      assert.deepEqual(JSON.parse(options.body), { to: 'friend@example.com', from: 'trials@example.com', subject: 'Trial', text: 'Private link' });
      return Response.json({ success: true, result });
    } });
  for (const [field, state] of [['queued', 'queued'], ['delivered', 'accepted'], ['permanent_bounces', 'bounced']]) {
    result = { [field]: ['friend@example.com'] };
    assert.deepEqual(await mailer.sendInvitation({ to: 'friend@example.com', subject: 'Trial', text: 'Private link' }), { state });
  }
  result = { queued: ['other@example.com'] };
  await assert.rejects(mailer.sendInvitation({ to: 'friend@example.com', subject: 'Trial', text: 'Private link' }));
  await assert.rejects(mailer.sendInvitation({ to: 'friend@example.com', subject: 'Trial\r\nBcc: victim@example.com', text: 'Private link' }));
});

test('Cloudflare configuration and provider failure never become a successful send', async () => {
  assert.throws(() => createCloudflareTrialMailer({ accountId: '../elsewhere', apiToken: 'test', from: 'sender@example.com' }));
  const mailer = createCloudflareTrialMailer({ accountId: 'b'.repeat(32), apiToken: 'synthetic-token-for-local-tests', from: 'trials@example.com',
    fetchImpl: async () => Response.json({ success: false, errors: [{ message: 'private provider diagnostic' }] }, { status: 403 }) });
  await assert.rejects(mailer.sendInvitation({ to: 'friend@example.com', subject: 'Trial', text: 'Link' }), /not confirmed/);
});

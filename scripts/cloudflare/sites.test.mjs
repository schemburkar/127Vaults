import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { siteConfig, siteSecrets, renderSites, siteOrder, deploySites } from './sites.mjs';
import { validateConfig } from './config.mjs';
import { accessPolicies, assertAccess, mfa } from './access.mjs';
import { runWrangler } from './deploy.mjs';
import publicWorker from '../../apps/public-intake/cloudflare/public-site.mjs';
import { customerInvitation } from '../../apps/public-intake/cloudflare/worker.mjs';
import { recordFingerprints, verifyRetainedRecords } from './site-records.mjs';

const config = { schemaVersion: 1, accountId: 'a'.repeat(32), origin: 'https://127vaults.example', workerName: 'vaults-test',
  databaseName: 'vaults-test', bucketName: 'vaults-private-test', releaseId: 'test', issuerKeyId: 'trial',
  sites: { adminOrigin: 'https://admin.127vaults.example', customerOrigin: 'https://manage.127vaults.example', adminEmails: ['owner@example.com'] } };
const state = { databaseId: '11111111-1111-4111-8111-111111111111' };

test('Turnstile secret belongs only to intake and volume settings only to Admin', async () => {
  const settings = { ...config, intakeProtection: { siteKey: 'synthetic-site-key', waitMs: 15000, cookieCooldownMs: 60000, volumeThreshold: 7, volumeWindowMs: 14400000 } };
  const secrets = { INTAKE_KEY: 'a'.repeat(64), OPERATOR_TOKEN: 'b'.repeat(43), TURNSTILE_SECRET_KEY: 'synthetic-private-secret' };
  for (const surface of ['public', 'customer', 'admin']) {
    assert.equal((await siteSecrets(surface, secrets)).TURNSTILE_SECRET_KEY, undefined);
    assert.equal(siteConfig(settings, state, surface, 'assets').vars.TURNSTILE_SITE_KEY, undefined);
  }
  assert.equal((await siteSecrets('intake', secrets)).TURNSTILE_SECRET_KEY, secrets.TURNSTILE_SECRET_KEY);
  assert.equal(siteConfig(settings, state, 'intake').vars.INTAKE_WAIT_MS, '15000');
  assert.equal(siteConfig(settings, state, 'intake').vars.INTAKE_VOLUME_THRESHOLD, undefined);
  assert.equal(siteConfig(settings, state, 'public', 'assets').vars.INTAKE_VOLUME_THRESHOLD, undefined);
  assert.equal(siteConfig(settings, state, 'admin', 'assets').vars.INTAKE_VOLUME_THRESHOLD, '7');
});
test('record preservation check detects changed or deleted invitations/licenses while allowing newly submitted requests', () => {
  const original = { id: 'original', received_at: 1, contact: 'encrypted-contact', trial: 'encrypted-invitation-and-license', version: 3 };
  const before = recordFingerprints([original]);
  assert.equal(verifyRetainedRecords(before, recordFingerprints([original, { ...original, id: 'new' }])).preservedRecords, 1);
  assert.throws(() => verifyRetainedRecords(before, {}), /changed/);
  assert.throws(() => verifyRetainedRecords(before, recordFingerprints([{ ...original, trial: 'replacement' }])), /changed/);
});
test('separated configuration rejects shared hosts, unexpected settings and unconfigured automatic email', () => {
  const value = { ...config, catalogueFile: join(tmpdir(), 'catalogue.json'), secretsDirectory: join(tmpdir(), 'vaults-secrets'), stateDirectory: join(tmpdir(), 'vaults-state') };
  assert.ok(validateConfig(value, join(tmpdir(), 'settings.json')));
  for (const sites of [{ ...config.sites, customerOrigin: config.origin }, { ...config.sites, adminEmails: [] },
    { ...config.sites, emailLogin: true }, { ...config.sites, bypass: true }]) assert.throws(() => validateConfig({ ...value, sites }, join(tmpdir(), 'settings.json')));
});
test('deployed bindings and secrets enforce each site role and retain existing D1/R2 identities', async () => {
  const secrets = { INTAKE_KEY: 'a'.repeat(64), OPERATOR_TOKEN: 'b'.repeat(43), TRIAL_ISSUER_PRIVATE_KEY: 'private', DODO_API_KEY: 'payment' };
  const pub = siteConfig(config, state, 'public', 'assets');
  assert.equal(pub.d1_databases, undefined); assert.equal(pub.r2_buckets, undefined); assert.equal(pub.send_email, undefined);
  assert.deepEqual(pub.services, [{ binding: 'INTAKE', service: 'vaults-test-intake' }]);
  assert.deepEqual(await siteSecrets('public', secrets), {});
  const intake = siteConfig(config, state, 'intake');
  assert.deepEqual(intake.routes, []); assert.equal(intake.assets, undefined); assert.equal(intake.r2_buckets, undefined);
  const keys = await siteSecrets('intake', secrets);
  assert.deepEqual(Object.keys(keys).sort(), ['INTAKE_CONTACT_KEY', 'INTAKE_LIMITER_KEY']);
  assert.notEqual(keys.INTAKE_CONTACT_KEY, keys.INTAKE_LIMITER_KEY);
  const customer = siteConfig(config, state, 'customer', 'assets');
  assert.equal(customer.vars.SITE_SURFACE, 'customer'); assert.equal(customer.vars.CUSTOMER_MANUAL_MAIL, '1');
  assert.equal((await siteSecrets('customer', secrets)).OPERATOR_TOKEN, undefined);
  assert.equal(customer.d1_databases[0].database_id, state.databaseId); assert.equal(customer.r2_buckets[0].bucket_name, config.bucketName);
  assert.deepEqual(customer.triggers.crons, []);
  assert.equal(siteConfig(config, state, 'admin', 'assets').triggers.crons.length, 1);
});
test('all four separated Workers compile with real Wrangler and role-specific static assets', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-separated-build-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = { ...config, stateDirectory: directory };
  const files = await renderSites(settings, state);
  for (const surface of siteOrder) {
    const generated = JSON.parse(await readFile(files[surface], 'utf8'));
    assert.equal(generated.workers_dev, false); assert.equal(generated.preview_urls, false);
    const output = await runWrangler(['deploy', '--config', files[surface], '--dry-run', '--outdir', join(directory, 'bundles', surface)], settings, { capture: true });
    assert.match(output, /dry.run|exiting now/i);
  }
});
test('admin Access requires the exact allowlist plus independent MFA; automation needs a named service token', () => {
  const app = { type: 'self_hosted', domain: 'admin.127vaults.example', mfa_config: mfa };
  const policies = accessPolicies(config, 'service-id');
  assertAccess(config, app, policies, 'service-id');
  assert.throws(() => assertAccess(config, app, [...policies, { decision: 'bypass' }], 'service-id'));
  assert.throws(() => assertAccess(config, { ...app, mfa_config: { mfa_disabled: true } }, policies, 'service-id'));
  assert.throws(() => assertAccess(config, app, [{ ...policies[0], include: [{ everyone: {} }] }, policies[1]], 'service-id'));
});
test('explicitly deferred Access does not call its API or require deployment service credentials', async () => {
  const { configureAccess, accessHeaders } = await import('./access.mjs');
  const settings = { ...config, sites: { ...config.sites, adminAccess: false } };
  const result = await configureAccess(settings, {}, { api: () => { throw Error('Unexpected Access API call'); } });
  assert.equal(result.mfaRequired, false); assert.equal(result.enabled, false);
  assert.deepEqual(await accessHeaders(settings), {});
  await assert.rejects(configureAccess(settings, { accessApplicationId: 'existing' }), /explicit change/);
});
test('new invitation host preserves the credential without rotating or modifying persisted invitation data', () => {
  const original = { subject: 'Invitation', text: 'Open https://127vaults.example/trial?open=1#request.token\nOther https://elsewhere.example/trial#leave.me' };
  const result = customerInvitation(original, { PUBLIC_SITE_ORIGIN: config.origin, CUSTOMER_ORIGIN: config.sites.customerOrigin });
  assert.match(result.text, /https:\/\/manage\.127vaults\.example\/trial\?open=1#request.token/);
  assert.match(result.text, /https:\/\/elsewhere.example\/trial#leave.me/);
  assert.match(original.text, /https:\/\/127vaults.example\/trial/);
});
test('public site redirects old browser invitation pages but never forwards an installer API or an admin request', async () => {
  let calls = 0;
  const env = { PUBLIC_INTAKE_ORIGIN: config.origin, CUSTOMER_ORIGIN: config.sites.customerOrigin,
    ASSETS: { fetch: () => { calls++; return new Response('missing', { status: 404 }); } } };
  const response = await publicWorker.fetch(new Request(config.origin + '/trial?open=1'), env);
  assert.equal(response.status, 302); assert.equal(response.headers.get('location'), config.sites.customerOrigin + '/trial?open=1');
  for (const path of ['/api/trials/' + 'a'.repeat(64) + '/installer', '/api/access-admin/requests']) {
    assert.equal((await publicWorker.fetch(new Request(config.origin + path, { headers: { Authorization: 'Bearer secret' } }), env)).status, 404);
  }
  assert.equal(calls, 0);
});
test('site cutover orders dependencies before public and deletes retained public secrets only after activation', async t => {
  const directory = await mkdtemp(join(tmpdir(), '127v-separated-deploy-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = []; let retained = [{ name: 'INTAKE_KEY' }];
  await deploySites({ ...config, stateDirectory: directory }, { ...state }, { INTAKE_KEY: 'a'.repeat(64) }, async args => {
    const generated = JSON.parse(await readFile(args[args.indexOf('--config') + 1], 'utf8'));
    calls.push(generated.name);
  }, { access: async () => calls.push('access'), api: async (path, options) => {
    if (options?.method === 'DELETE') { calls.push('remove-public-secret'); retained = []; } return retained;
  } });
  assert.deepEqual(calls, ['access', 'vaults-test-customer', 'vaults-test-admin', 'vaults-test-intake', 'vaults-test', 'remove-public-secret']);
});

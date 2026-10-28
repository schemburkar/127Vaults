import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { issueSelfHostedLicense } from '../../../scripts/ops/issue-self-hosted-license.mjs';
import { issueLicenseRevocation } from '../../../scripts/ops/issue-license-revocation.mjs';
import { subscriptionLicense } from '../src/subscription-refresh.mjs';
import { verifyLicenseFile, verifyLicenseRevocationFile, licenseStatus } from '../src/license-status.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'vaults-subscription-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const privateKeyPem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const installationId = randomUUID(), now = Date.parse('2026-10-28T00:00:00Z');
  const issue = sequence => issueSelfHostedLicense({ privateKeyPem, keyId: 'test', installationId,
    plan: 'commercial', majorVersion: null, maxActiveUsers: 8, sequence,
    expiresAt: new Date(now + sequence * 86400000).toISOString(), now: new Date(now) });
  const first = issue(1), second = issue(2);
  const configFile = join(dir, 'config.json'), stateFile = join(dir, 'state.json');
  await writeFile(configFile, JSON.stringify({ refreshUrl: `https://example.com/api/billing/${'a'.repeat(64)}/refresh`, refreshToken: 'x'.repeat(43) }));
  const keys = JSON.parse(first.publicKeys);
  // The issuer helper returns the public key map used by installation verification.
  const options = { configFile, stateFile, installationId, original: first.license, keys,
    verify: verifyLicenseFile, verifyRevocation: verifyLicenseRevocationFile, now };
  return { ...options, dir, first, second, issue, privateKeyPem };
}
test('subscription refresh verifies signed renewals, coalesces parallel requests and persists across restart', async t => {
  const f = await fixture(t); let calls = 0;
  const fetcher = async (_url, options) => { calls++; assert.equal(options.headers.Authorization, `Bearer ${'x'.repeat(43)}`); return Response.json({ license: f.second.license }); };
  const results = await Promise.all(Array.from({ length: 8 }, () => subscriptionLicense({ ...f, fetcher })));
  assert.equal(calls, 1); assert.ok(results.every(v => v.license === f.second.license));
  const cached = await subscriptionLicense({ ...f, fetcher: async () => { throw Error('must use durable state'); } });
  assert.equal(cached.license, f.second.license);
  assert.equal(JSON.parse(await readFile(f.stateFile, 'utf8')).license, f.second.license);
});
test('subscription provider outages and rollback attempts cannot extend or replace the last signed license', async t => {
  const f = await fixture(t);
  await subscriptionLicense({ ...f, fetcher: async () => Response.json({ license: f.second.license }) });
  for (const fetcher of [async () => { throw Error('offline'); }, async () => Response.json({ license: f.first.license }),
    async () => Response.json({ license: f.second.license.replace('signature', 'forged') })]) {
    const result = await subscriptionLicense({ ...f, now: f.now + 3 * 86400000, fetcher });
    assert.equal(result.license, f.second.license);
    assert.equal(licenseStatus(verifyLicenseFile(result.license, f.keys, f.installationId), new Date(f.now + 3 * 86400000)).mode, 'read-only');
  }
});
test('subscription refresh retains signed revocations through provider outages', async t => {
  const f = await fixture(t);
  const license = verifyLicenseFile(f.second.license, f.keys, f.installationId);
  const result = issueLicenseRevocation({ privateKeyPem: f.privateKeyPem, keyId: 'test', installationId: f.installationId,
    licenseId: license.licenseId, revokedAt: 'now', now: new Date(f.now) });
  const revocation = result;
  const accepted = await subscriptionLicense({ ...f, fetcher: async () => Response.json({ license: f.second.license, revocation }) });
  assert.equal(accepted.revocation, revocation);
  const offline = await subscriptionLicense({ ...f, now: f.now + 86400000, fetcher: async () => { throw Error('offline'); } });
  assert.equal(offline.revocation, revocation);
});

test('subscription refresh cannot race another process holding the durable state lock', async t => {
  const f = await fixture(t);
  await writeFile(`${f.stateFile}.lock`, '');
  let requests = 0;
  const result = await subscriptionLicense({ ...f, fetcher: async () => { requests++; return Response.json({ license: f.second.license }); } });
  assert.equal(result.license, f.first.license); assert.equal(requests, 0);
});

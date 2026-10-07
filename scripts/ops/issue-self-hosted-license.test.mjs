import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { issueSelfHostedLicense } from './issue-self-hosted-license.mjs';
import { verifyLicenseFile } from '../../apps/server/src/license-status.mjs';

const privateKeyPem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
const installationId = randomUUID();
const base = { privateKeyPem, keyId: 'pilot', installationId, plan: 'personal', majorVersion: 1,
  maxActiveUsers: 5, sequence: 1, expiresAt: '2027-10-07T00:00:00.000Z', now: new Date('2026-10-07T00:00:00.000Z') };

test('offline issuer creates an installation-bound license and matching public key file', () => {
  const { license, publicKeys } = issueSelfHostedLicense(base);
  assert.equal(verifyLicenseFile(license, JSON.parse(publicKeys), installationId).plan, 'personal');
  assert.throws(() => verifyLicenseFile(license, JSON.parse(publicKeys), randomUUID()), /invalid_license/);
});

test('issuer rejects invalid terms and expiry', () => {
  assert.throws(() => issueSelfHostedLicense({ ...base, maxActiveUsers: 0 }), /Invalid license request/);
  assert.throws(() => issueSelfHostedLicense({ ...base, expiresAt: '2026-10-06T00:00:00.000Z' }), /Invalid license request/);
  assert.throws(() => issueSelfHostedLicense({ ...base, majorVersion: null }), /invalid_license/);
});

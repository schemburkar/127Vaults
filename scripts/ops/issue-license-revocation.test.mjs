import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { issueLicenseRevocation } from './issue-license-revocation.mjs';
import { verifyLicenseRevocationFile } from '../../apps/server/src/license-status.mjs';

test('issuer signs a revocation for exactly one installation and license', () => {
  const pair = generateKeyPairSync('ed25519');
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const keys = { test: pair.publicKey.export({ type: 'spki', format: 'pem' }) };
  const installationId = randomUUID();
  const licenseId = randomUUID();
  const source = issueLicenseRevocation({ privateKeyPem, keyId: 'test', installationId, licenseId,
    now: new Date('2026-10-07T00:00:00.000Z'), revokedAt: '2026-10-07T00:00:00.000Z' });
  assert.equal(verifyLicenseRevocationFile(source, keys, installationId, licenseId).licenseId, licenseId);
  assert.throws(() => verifyLicenseRevocationFile(source, keys, randomUUID(), licenseId), /invalid_license/);
  assert.throws(() => verifyLicenseRevocationFile(source, keys, installationId, randomUUID()), /invalid_license/);
  const tampered = JSON.parse(source);
  tampered.payload = Buffer.from(JSON.stringify({ licenseId: randomUUID() })).toString('base64url');
  assert.throws(() => verifyLicenseRevocationFile(JSON.stringify(tampered), keys, installationId), /invalid_license/);
  assert.equal(verifyLicenseRevocationFile(issueLicenseRevocation({ privateKeyPem, keyId: 'test',
    installationId, licenseId, now: new Date('2026-10-07T00:00:00.000Z'), revokedAt: 'now' }),
  keys, installationId, licenseId).revokedAt, '2026-10-07T00:00:00.000Z');
});

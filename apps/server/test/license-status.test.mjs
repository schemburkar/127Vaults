import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { licenseStatus, verifyLicenseFile } from '../src/license-status.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const installationId = randomUUID();
const publicKeys = { test: publicKey.export({ type: 'spki', format: 'pem' }) };
const payload = () => ({ licenseId: randomUUID(), installationId, plan: 'personal', majorVersion: 1,
  maxActiveUsers: 5, issuedAt: '2026-10-01T00:00:00.000Z', notBefore: '2026-10-01T00:00:00.000Z',
  expiresAt: '2027-10-01T00:00:00.000Z', sequence: 1 });
const file = body => {
  const bytes = Buffer.from(JSON.stringify(body));
  return JSON.stringify({ schemaVersion: 1, keyId: 'test', payload: bytes.toString('base64url'),
    signature: sign(null, Buffer.concat([Buffer.from('127Vaults license v1\0'), bytes]), privateKey).toString('base64url') });
};

test('signed license is installation-bound and enters grace without changing its data', () => {
  const source = file(payload());
  const accepted = verifyLicenseFile(source, publicKeys, installationId);
  assert.equal(licenseStatus(accepted, new Date('2026-10-06T00:00:00Z')).mode, 'active');
  assert.equal(licenseStatus(accepted, new Date('2027-10-01T00:00:00Z')).mode, 'read-only');
  assert.equal(licenseStatus(accepted, new Date('2027-10-31T00:00:00Z')).mode, 'locked');
  assert.equal(accepted.maxActiveUsers, 5);
  assert.throws(() => verifyLicenseFile(source, publicKeys, randomUUID()), /invalid_license/);
});

test('tampering, unknown keys, and malformed limits are rejected', () => {
  const signed = JSON.parse(file(payload()));
  signed.payload = Buffer.from(JSON.stringify({ ...payload(), installationId })).toString('base64url');
  assert.throws(() => verifyLicenseFile(JSON.stringify(signed), publicKeys, installationId), /invalid_license/);
  signed.keyId = 'missing';
  assert.throws(() => verifyLicenseFile(JSON.stringify(signed), publicKeys, installationId), /invalid_license/);
  assert.throws(() => verifyLicenseFile(file({ ...payload(), maxActiveUsers: 0 }), publicKeys, installationId), /invalid_license/);
});

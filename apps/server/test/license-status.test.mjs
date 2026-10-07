import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { licenseStatus, loadLicenseStatus, verifyLicenseFile } from '../src/license-status.mjs';
import { issueLicenseRevocation } from '../../../scripts/ops/issue-license-revocation.mjs';

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

test('current license enters revoked state but a renewed license is unaffected', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-license-status-'));
  const licenseFile = join(dir, 'license.json');
  const publicKeyFile = join(dir, 'keys.json');
  const revocationFile = join(dir, 'revocation.json');
  const now = new Date('2026-10-07T00:00:00.000Z');
  try {
    const first = payload();
    await writeFile(licenseFile, file(first));
    await writeFile(publicKeyFile, JSON.stringify(publicKeys));
    await writeFile(revocationFile, issueLicenseRevocation({
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keyId: 'test', installationId,
      licenseId: first.licenseId, now, revokedAt: now.toISOString() }));
    const options = { licenseFile, publicKeyFile, revocationFile, installationId, now };
    const revoked = await loadLicenseStatus(options);
    assert.equal(revoked.mode, 'revoked');
    assert.equal(revoked.revokedAt, now.toISOString());
    await writeFile(licenseFile, file({ ...payload(), sequence: 2 }));
    assert.equal((await loadLicenseStatus(options)).mode, 'active');
    const clockBlocked = await loadLicenseStatus({ ...options,
      clock: { observe: async () => ({ now, clockState: 'rollback_detected' }) } });
    assert.equal(clockBlocked.mode, 'locked');
    assert.equal(clockBlocked.clockState, 'rollback_detected');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installLicenseFiles, installRevocationFile } from './license-files.mjs';
import { issueSelfHostedLicense } from '../scripts/ops/issue-self-hosted-license.mjs';
import { issueLicenseRevocation } from '../scripts/ops/issue-license-revocation.mjs';

test('local license installation verifies binding and refuses replay or lower sequence', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-license-install-'));
  const envPath = join(dir, '.env');
  const installationId = randomUUID();
  const privateKeyPem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const now = new Date('2026-10-07T00:00:00.000Z');
  const issue = sequence => issueSelfHostedLicense({ privateKeyPem, keyId: 'test', installationId, plan: 'personal',
    majorVersion: 1, maxActiveUsers: 5, sequence, expiresAt: '2027-10-07T00:00:00.000Z', now });
  const first = issue(1);
  try {
    await writeFile(envPath, 'VAULTS_PROJECT=test\n');
    const options = { runtimeDir: dir, envPath, installationId, licenseSource: first.license,
      keySource: first.publicKeys, now };
    assert.equal((await installLicenseFiles(options)).sequence, 1);
    assert.match(await readFile(envPath, 'utf8'), /VAULTS_LICENSE_FILE=\/run\/secrets\/runtime\/licenses\/1.json/);
    await assert.rejects(installLicenseFiles(options), /sequence must be higher/);
    await assert.rejects(installLicenseFiles({ ...options, installationId: randomUUID() }), /invalid_license/);
    const second = issue(2);
    assert.equal((await installLicenseFiles({ ...options, licenseSource: second.license, keySource: second.publicKeys })).sequence, 2);
    const current = await readFile(envPath, 'utf8');
    assert.equal((current.match(/^VAULTS_LICENSE_FILE=/gm) ?? []).length, 1);
    assert.match(current, /licenses\/2.json/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('revocation installation binds to the current signed license and renewal clears it', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-license-revoke-'));
  const envPath = join(dir, '.env');
  const installationId = randomUUID();
  const privateKeyPem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const now = new Date('2026-10-07T00:00:00.000Z');
  const issue = sequence => issueSelfHostedLicense({ privateKeyPem, keyId: 'test', installationId,
    plan: 'personal', majorVersion: 1, maxActiveUsers: 5, sequence, expiresAt: '2027-10-07T00:00:00.000Z', now });
  try {
    await writeFile(envPath, 'VAULTS_PROJECT=test\n');
    const first = issue(1);
    await installLicenseFiles({ runtimeDir: dir, envPath, installationId,
      licenseSource: first.license, keySource: first.publicKeys, now });
    const licenseId = JSON.parse(Buffer.from(JSON.parse(first.license).payload, 'base64url').toString()).licenseId;
    const revocationSource = issueLicenseRevocation({ privateKeyPem, keyId: 'test', installationId,
      licenseId, revokedAt: now.toISOString(), now });
    await assert.rejects(installRevocationFile({ runtimeDir: dir, envPath, installationId,
      revocationSource: issueLicenseRevocation({ privateKeyPem, keyId: 'test', installationId,
        licenseId: randomUUID(), revokedAt: now.toISOString(), now }) }), /invalid_license/);
    await installRevocationFile({ runtimeDir: dir, envPath, installationId, revocationSource });
    assert.match(await readFile(envPath, 'utf8'), /VAULTS_LICENSE_REVOCATION_FILE=/);
    const second = issue(2);
    await installLicenseFiles({ runtimeDir: dir, envPath, installationId,
      licenseSource: second.license, keySource: second.publicKeys, now });
    assert.doesNotMatch(await readFile(envPath, 'utf8'), /VAULTS_LICENSE_REVOCATION_FILE=/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

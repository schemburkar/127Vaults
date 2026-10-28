import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureSubscription, installLicenseFiles, installRevocationFile, restoredLicenseEnvironment } from './license-files.mjs';
import { issueSelfHostedLicense } from '../scripts/ops/issue-self-hosted-license.mjs';
import { issueLicenseRevocation } from '../scripts/ops/issue-license-revocation.mjs';

test('subscription setup validates private refresh settings and rotates them without duplicating environment settings', async t => {
  const dir = await mkdtemp(join(tmpdir(), '127v-subscription-install-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const envPath = join(dir, '.env'); await writeFile(envPath, 'PRESERVE=yes\n');
  const input = { refreshUrl: `https://billing.example.com/api/billing/${'a'.repeat(64)}/refresh`, refreshToken: 'x'.repeat(43) };
  for (const changed of [{ refreshUrl: 'http://localhost/refresh' }, { refreshToken: 'bad' }, { refreshUrl: input.refreshUrl + '?token=secret' }]) {
    await assert.rejects(configureSubscription({ runtimeDir: dir, envPath, source: JSON.stringify({ ...input, ...changed }) }));
  }
  await configureSubscription({ runtimeDir: dir, envPath, source: JSON.stringify(input) });
  await configureSubscription({ runtimeDir: dir, envPath, source: JSON.stringify({ ...input, refreshToken: 'y'.repeat(43) }) });
  assert.equal(JSON.parse(await readFile(join(dir, 'subscription.json'), 'utf8')).refreshToken, 'y'.repeat(43));
  const env = await readFile(envPath, 'utf8'); assert.match(env, /PRESERVE=yes/); assert.equal((env.match(/VAULTS_SUBSCRIPTION_FILE=/g) ?? []).length, 1);
});

test('manual installation and revocation respect the newer automatically renewed license and survive restore', async t => {
  const dir = await mkdtemp(join(tmpdir(), '127v-subscription-high-water-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const runtimeDir = join(dir, 'runtime'), envPath = join(dir, '.env'); await writeFile(envPath, 'PRESERVE=yes\n');
  const privateKeyPem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const installationId = randomUUID(), now = new Date('2026-10-28T00:00:00Z');
  const issue = sequence => issueSelfHostedLicense({ privateKeyPem, keyId: 'test', installationId, plan: 'commercial', majorVersion: null,
    maxActiveUsers: 8, sequence, expiresAt: '2027-10-01T00:00:00.000Z', now });
  const first = issue(1), newer = issue(3);
  await installLicenseFiles({ runtimeDir, envPath, installationId, licenseSource: first.license, keySource: first.publicKeys, now });
  await mkdir(join(dir, 'output'));
  await writeFile(join(dir, 'output', 'subscription-license.json'), JSON.stringify({ license: newer.license, checkedAt: now.getTime() }));
  await assert.rejects(installLicenseFiles({ runtimeDir, envPath, installationId, licenseSource: issue(2).license, keySource: first.publicKeys, now }), /sequence/);
  const current = JSON.parse(Buffer.from(JSON.parse(newer.license).payload, 'base64url').toString());
  const revocation = issueLicenseRevocation({ privateKeyPem, keyId: 'test', installationId, licenseId: current.licenseId, revokedAt: 'now', now });
  await installRevocationFile({ runtimeDir, envPath, installationId, revocationSource: revocation });
  assert.match((await restoredLicenseEnvironment({ runtimeDir, installationId })).join('\n'), new RegExp(current.licenseId));
});

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
    assert.deepEqual(await restoredLicenseEnvironment({runtimeDir:dir,installationId}),[
      'VAULTS_LICENSE_FILE=/run/secrets/runtime/licenses/2.json','VAULTS_LICENSE_PUBLIC_KEYS_FILE=/run/secrets/runtime/licenses/2.keys.json']);
    await assert.rejects(restoredLicenseEnvironment({runtimeDir:dir,installationId:randomUUID()}),/invalid_license/);
    await writeFile(join(dir,'licenses/highest-sequence'),'3');
    await assert.rejects(restoredLicenseEnvironment({runtimeDir:dir,installationId}),/incomplete/);
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
    assert.match((await restoredLicenseEnvironment({runtimeDir:dir,installationId})).join('\n'),/VAULTS_LICENSE_REVOCATION_FILE=/);
    const second = issue(2);
    await installLicenseFiles({ runtimeDir: dir, envPath, installationId,
      licenseSource: second.license, keySource: second.publicKeys, now });
    assert.doesNotMatch(await readFile(envPath, 'utf8'), /VAULTS_LICENSE_REVOCATION_FILE=/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTH_COOKIE } from '../src/auth-policy.mjs';
import { createLicenseWriteGuard, isLicensedWrite } from '../src/license-write-guard.mjs';
import { issueLicenseRevocation } from '../../../scripts/ops/issue-license-revocation.mjs';

test('license gate covers vault writes and invitations while keeping access and restore paths open', () => {
  for (const path of ['/api/v1/vaults', '/api/v1/invitations', '/api/v1/vaults/abc/items',
    '/api/v1/vaults/abc/operations', '/api/v1/vaults/abc/checkpoint', '/api/v1/vaults/abc/removal']) {
    assert.equal(isLicensedWrite('POST', path), true, path);
  }
  assert.equal(isLicensedWrite('PUT', '/api/v1/vault-settings'), true);
  assert.equal(isLicensedWrite('PUT', '/api/v1/vaults/abc/items/def'), true);
  assert.equal(isLicensedWrite('DELETE', '/api/v1/vaults/abc/items/def'), true);
  assert.equal(isLicensedWrite('DELETE', '/api/v1/vaults/abc/items'), false);
  for (const path of ['/api/v1/auth/', '/api/v1/session', '/api/v1/vaults/abc/restore',
    '/api/v1/devices/rotate-account-secret', '/api/v1/onboarding/register']) {
    assert.equal(isLicensedWrite('POST', path), false, path);
  }
  assert.equal(isLicensedWrite('GET', '/api/v1/vaults/abc/items'), false);
});

test('signed license grace blocks writes and renewal reopens them', async () => {
  const dir = await mkdtemp(join(tmpdir(), '127v-license-gate-'));
  const installationId = randomUUID();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keysFile = join(dir, 'keys.json');
  const licenseFile = join(dir, 'license.json');
  const revocationFile = join(dir, 'revocation.json');
  await writeFile(keysFile, JSON.stringify({ test: publicKey.export({ type: 'spki', format: 'pem' }) }));
  const issue = async expiresAt => {
    const payload = Buffer.from(JSON.stringify({ licenseId: randomUUID(), installationId, plan: 'personal',
      majorVersion: 1, maxActiveUsers: 5, issuedAt: '2025-01-01T00:00:00.000Z',
      notBefore: '2025-01-01T00:00:00.000Z', expiresAt, sequence: 1 }));
    await writeFile(licenseFile, JSON.stringify({ schemaVersion: 1, keyId: 'test', payload: payload.toString('base64url'),
      signature: sign(null, Buffer.concat([Buffer.from('127Vaults license v1\0'), payload]), privateKey).toString('base64url') }));
  };
  const guard = createLicenseWriteGuard({ pool: { query: async () => ({ rows: [{ id: installationId }] }) },
    authenticate: async token => { if (token !== 'A'.repeat(43)) throw Error('bad session'); },
    origin: 'https://127.0.0.1:12780', licenseFile, publicKeyFile: keysFile });
  const server = createServer(async (req, res) => { if (!await guard(req, res)) { res.writeHead(204); res.end(); } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { cookie: `${AUTH_COOKIE}=${'A'.repeat(43)}` };
  try {
    await issue('2026-10-01T00:00:00.000Z');
    const blocked = await fetch(`${url}/api/v1/vaults`, { method: 'POST', headers });
    assert.equal(blocked.status, 423);
    assert.deepEqual(await blocked.json(), { error: 'license_read_only' });
    assert.equal((await fetch(`${url}/api/v1/vaults`, { method: 'GET' })).status, 401);
    assert.equal((await fetch(`${url}/api/v1/vaults/abc/restore`, { method: 'POST' })).status, 204);
    assert.equal((await fetch(`${url}/api/v1/vaults`, { headers })).status, 204);
    await issue('2025-10-01T00:00:00.000Z');
    assert.equal((await fetch(`${url}/api/v1/vaults`, { headers })).status, 423);
    await issue('2030-10-01T00:00:00.000Z');
    assert.equal((await fetch(`${url}/api/v1/vaults`, { method: 'POST', headers })).status, 204);
    const signed = JSON.parse(await readFile(licenseFile, 'utf8'));
    const licenseId = JSON.parse(Buffer.from(signed.payload, 'base64url').toString()).licenseId;
    await writeFile(revocationFile, issueLicenseRevocation({
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keyId: 'test', installationId,
      licenseId, now: new Date('2026-10-07T00:00:00.000Z'), revokedAt: 'now' }));
    const revokedGuard = createLicenseWriteGuard({ pool: { query: async () => ({ rows: [{ id: installationId }] }) },
      authenticate: async () => ({}), origin: 'https://127.0.0.1:12780', licenseFile,
      publicKeyFile: keysFile, revocationFile });
    const response = { status: null, body: null,
      writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
    assert.equal(await revokedGuard({ method: 'POST', url: '/api/v1/vaults', headers }, response), true);
    assert.equal(response.status, 423);
    assert.deepEqual(response.body, { error: 'license_revoked' });
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

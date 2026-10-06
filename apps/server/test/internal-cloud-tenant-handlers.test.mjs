import test from 'node:test';
import assert from 'node:assert/strict';
import { createInternalCloudTenantHandlers } from '../internal-cloud/tenant-handlers.mjs';

const tenantId = '11111111-1111-4111-8111-111111111111';
const origin = 'https://alice.asia.example.com';
const handle = createInternalCloudTenantHandlers({
  bridge: { server_public_key: () => Buffer.alloc(32) }, tokenKey: Buffer.alloc(32),
  checkpointPrivateKey: {}, checkpointPublicKey: 'public-key'
});
const context = { tenant: { id: tenantId, region: 'asia' }, origin,
  pool: { query: async () => ({ rows: [{ setup_bytes: Buffer.alloc(96) }] }) },
  requirePrincipal: value => value };

async function exchange(path) {
  let status, body;
  const req = { method: 'GET', url: path, headers: { origin } };
  const res = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
  await handle(req, res, context);
  return { status, body };
}

test('Cloud tenant handlers mount tenant-scoped login but refuse unreviewed control paths', async () => {
  const ceremony = await exchange('/api/v1/ceremony');
  assert.equal(ceremony.status, 200);
  assert.match(ceremony.body.csrf, /^[A-Za-z0-9_-]{43}$/);
  for (const path of ['/api/v1/onboarding/register', '/api/v1/invitations', '/api/v1/license', '/admin']) {
    assert.deepEqual(await exchange(path), { status: 404, body: { error: 'not_found' } });
  }
});

test('Cloud discovery exposes the routed tenant and protocol identity without account data', async () => {
  assert.deepEqual(await exchange('/api/v1/cloud/discovery'), { status: 200, body: {
    version: 1, tenantId, canonicalOrigin: origin, region: 'asia',
    protocolVersions: { api: 1, sync: 1 }, serverPublicKey: Buffer.alloc(32).toString('base64url'),
    checkpointPublicKey: 'public-key'
  } });
  let status;
  await handle({ method: 'POST', url: '/api/v1/cloud/discovery', headers: { origin } },
    { writeHead(code) { status = code; }, end() {} }, context);
  assert.equal(status, 405);
});

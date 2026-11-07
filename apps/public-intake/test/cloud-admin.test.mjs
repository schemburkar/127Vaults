import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { handleCloudAdmin } from '../cloudflare/cloud-admin.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  ADMIN_ORIGIN: 'https://admin.example.test', CLOUD_ADMIN_ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
  CLOUD_ADMIN_ACCESS_AUDIENCE: 'a'.repeat(64), CLOUD_ADMIN_OPERATORS: 'owner@example.test',
  CLOUD_MANAGEMENT_ORIGIN: 'https://internal.example.test', CLOUD_MANAGEMENT_TOKEN: 'b'.repeat(64),
  CLOUD_MANAGEMENT_ACCESS_ID: 'test.access', CLOUD_MANAGEMENT_ACCESS_SECRET: 'fixture'
};
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function assertion(claims = {}) {
  const header = encode({ alg: 'RS256', kid: 'test' });
  const payload = encode({ aud: [env.CLOUD_ADMIN_ACCESS_AUDIENCE], iss: env.CLOUD_ADMIN_ACCESS_ISSUER,
    email: 'owner@example.test', sub: 'named-operator', type: 'app', custom: { amr: ['mfa'] },
    exp: Math.floor(Date.now() / 1000) + 60, ...claims });
  const message = `${header}.${payload}`;
  return `${message}.${sign('sha256', Buffer.from(message), privateKey).toString('base64url')}`;
}
function request(token, origin = env.ADMIN_ORIGIN) {
  return new Request(`${env.ADMIN_ORIGIN}/cloud-tenants/api/list`, {
    method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', Origin: origin,
      Authorization: 'Bearer legacy-operator-key', 'X-127V-Operator': 'spoofed',
      ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}) }
  });
}

test('Cloud admin uses the signed named identity and keeps its service credentials upstream', async () => {
  const response = await handleCloudAdmin(request(assertion()), env, async (url, options) => {
    if (url.endsWith('/certs')) return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test' }] });
    assert.equal(url, `${env.CLOUD_MANAGEMENT_ORIGIN}/internal/cloud/v1/list`);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['X-127V-Operator'], 'named-operator');
    assert.equal(options.headers.Authorization, `Bearer ${env.CLOUD_MANAGEMENT_TOKEN}`);
    assert.equal(options.headers['CF-Access-Client-Id'], env.CLOUD_MANAGEMENT_ACCESS_ID);
    assert.equal(options.headers.Origin, undefined);
    assert.equal(await new Response(options.body).text(), '{}');
    return Response.json([]);
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), []);
});

test('Cloud admin rejects legacy credentials, missing MFA, other audiences, expired sessions and forged signatures', async () => {
  const valid = assertion();
  const forged = valid.slice(0, valid.lastIndexOf('.') + 1) + 'abcd';
  for (const token of [null, assertion({ custom: { amr: ['pwd'] } }), assertion({ aud: ['other'] }),
    assertion({ exp: 0 }), assertion({ email: 'other@example.test' }), forged]) {
    const response = await handleCloudAdmin(request(token), env, async url => {
      assert.equal(url, `${env.CLOUD_ADMIN_ACCESS_ISSUER}/cdn-cgi/access/certs`);
      return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test' }] });
    });
    assert.equal(response.status, 403);
  }
  assert.equal((await handleCloudAdmin(request(valid, 'https://foreign.example.test'), env)).status, 403);
});

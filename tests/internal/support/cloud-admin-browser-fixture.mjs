import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpsRequest } from 'node:https';
import { handleCloudAdmin } from '../../../apps/public-intake/cloudflare/cloud-admin.mjs';
import { createCloudManagementHttpsServer } from '../../../apps/server/internal-cloud/management.mjs';
import { containRequestErrors, readRequestBody } from '../../../apps/server/src/http-boundary.mjs';
import { adminAssets, readSiteAsset } from '../../../scripts/sites/assets.mjs';

export const adminHost = 'admin.asia.example.com';
export const managementHost = 'management.asia.example.com';
export const localOperator = 'local-cloud-operator';

export async function localCloudAdmin({ tls, pool, tokenKey, bridge }) {
  const serviceToken = randomBytes(32).toString('hex');
  const env = {
    ADMIN_ORIGIN: `https://${adminHost}`, CLOUD_ADMIN_ACCESS_ISSUER: 'https://local-fixture.cloudflareaccess.com',
    CLOUD_ADMIN_ACCESS_AUDIENCE: randomBytes(32).toString('hex'), CLOUD_ADMIN_OPERATORS: 'operator@example.com',
    CLOUD_MANAGEMENT_ORIGIN: `https://${managementHost}`, CLOUD_MANAGEMENT_TOKEN: serviceToken,
    CLOUD_MANAGEMENT_ACCESS_ID: 'fixture.access', CLOUD_MANAGEMENT_ACCESS_SECRET: 'local-synthetic-service-token'
  };
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = `${encode({ alg: 'RS256', kid: 'fixture' })}.${encode({ type: 'app', iss: env.CLOUD_ADMIN_ACCESS_ISSUER,
    aud: [env.CLOUD_ADMIN_ACCESS_AUDIENCE], email: env.CLOUD_ADMIN_OPERATORS, sub: localOperator,
    exp: Math.floor(Date.now() / 1000) + 600, custom: { amr: ['mfa'] } })}`;
  const assertion = `${message}.${sign('sha256', Buffer.from(message), privateKey).toString('base64url')}`;
  const management = await createCloudManagementHttpsServer({ tls, pool, serviceToken, tokenKey,
    createOpaqueSetup: () => Buffer.from(bridge.server_setup()) });
  const localFetch = async (url, options) => {
    if (url === `${env.CLOUD_ADMIN_ACCESS_ISSUER}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'fixture' }] });
    }
    const target = new URL(url);
    assert.equal(target.origin, env.CLOUD_MANAGEMENT_ORIGIN);
    const body = Buffer.from(await new Response(options.body).arrayBuffer());
    return new Promise((resolve, reject) => {
      const req = httpsRequest({ hostname: '127.0.0.1', port: management.address().port, path: target.pathname,
        servername: managementHost, ca: tls.cert, method: 'POST', headers: options.headers, signal: options.signal }, async res => {
        try {
          const chunks = [];
          for await (const chunk of res) chunks.push(chunk);
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode }));
        } catch (error) { reject(error); }
      });
      req.once('error', reject);
      req.end(body);
    });
  };
  const portal = createServer(tls, containRequestErrors(async (req, res) => {
    const url = new URL(req.url, env.ADMIN_ORIGIN);
    if (url.pathname.startsWith('/cloud-tenants/api/')) {
      const response = await handleCloudAdmin(new Request(url, { method: req.method, headers: req.headers,
        body: req.method === 'POST' ? await readRequestBody(req, 2048) : undefined }), env, localFetch);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(await response.text());
    }
    const name = url.pathname === '/cloud-tenants' ? 'cloud-tenants.html' : url.pathname.slice(1);
    if (!adminAssets.includes(name)) { res.writeHead(404); return res.end(); }
    const type = { html: 'text/html', mjs: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' }[name.split('.').at(-1)];
    res.writeHead(200, { 'Content-Type': type ?? 'application/octet-stream' });
    res.end(await readSiteAsset('admin', name));
  }));
  const close = () => Promise.all([portal, management].map(server => new Promise(resolve => server.close(resolve))));
  try {
    management.listen(0, '127.0.0.1');
    await once(management, 'listening');
    portal.listen(0, '127.0.0.1');
    await once(portal, 'listening');
    return { assertion, close, origin: env.ADMIN_ORIGIN, port: portal.address().port };
  } catch (error) { await close(); throw error; }
}

import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { handleRequest } from '../../../apps/public-intake/cloudflare/worker.mjs';
import { createCloudCustomerDirectoryHttpsServer, createCloudManagementHttpsServer } from '../../../apps/server/internal-cloud/management.mjs';
import { containRequestErrors, readRequestBody } from '../../../apps/server/src/http-boundary.mjs';
import { adminAssets, customerAssets, readSiteAsset, repository } from '../../../scripts/sites/assets.mjs';

export const adminHost = 'admin.asia.example.com';
export const managementHost = 'management.asia.example.com';
export const customerHost = 'manage.asia.example.com';
export const directoryHost = 'directory.asia.example.com';
export const localOperator = 'local-cloud-operator';

async function upstreamFetch(server, tls, request, host) {
  const target = new URL(request.url);
  assert.equal(target.origin, `https://${host}`);
  const body = Buffer.from(await request.arrayBuffer());
  return new Promise((resolve, reject) => {
    const outgoing = httpsRequest({ hostname: '127.0.0.1', port: server.address().port, path: target.pathname,
      servername: host, ca: tls.cert, method: request.method, headers: Object.fromEntries(request.headers),
      signal: request.signal }, async response => {
      try {
        const chunks = [];
        for await (const chunk of response) chunks.push(chunk);
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode }));
      } catch (error) { reject(error); }
    });
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}

const workerOptions = {
  modules: true, modulesRoot: repository, modulesRules: [{ type: 'ESModule', include: ['**/*.mjs'], fallthrough: true }],
  compatibilityDate: '2026-07-01'
};
function siteAssets(surface, allowed, home, file) {
  return async request => {
    const path = new URL(request.url).pathname;
    const name = path === home ? file : path.slice(1);
    if (!allowed.includes(name)) return new Response(null, { status: 404 });
    const type = { html: 'text/html', mjs: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' }[name.split('.').at(-1)];
    return new Response(await readSiteAsset(surface, name), { headers: { 'Content-Type': type ?? 'application/octet-stream' } });
  };
}
function browserProxy(tls, mf, origin) {
  return createServer(tls, containRequestErrors(async (req, res) => {
    const response = await mf.dispatchFetch(new URL(req.url, origin), {
      method: req.method, headers: req.headers,
      body: req.method === 'POST' ? await readRequestBody(req, 2048) : undefined
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }));
}

export async function localCloudManage({ tls, pool }) {
  const origin = `https://${customerHost}`, adminOrigin = `https://${adminHost}`;
  const customerDirectoryToken = randomBytes(32).toString('hex');
  const operatorToken = randomBytes(32).toString('hex');
  const bindings = {
    SITE_SURFACE: 'customer', PUBLIC_INTAKE_ORIGIN: origin, CUSTOMER_ORIGIN: origin,
    INTAKE_KEY: randomBytes(32).toString('hex'), TRIAL_ISSUER_KEY_ID: 'local',
    CUSTOMER_PORTAL_ENABLED: '1', CLOUD_CUSTOMER_PILOT_MANUAL_LOGIN: '1',
    CLOUD_CUSTOMER_DIRECTORY_ORIGIN: `https://${directoryHost}`, CLOUD_CUSTOMER_DIRECTORY_TOKEN: customerDirectoryToken
  };
  const directory = createCloudCustomerDirectoryHttpsServer({ tls, pool, customerDirectoryToken });
  let directoryResult = 'no request';
  const mf = new Miniflare({
    ...workerOptions, scriptPath: join(repository, 'apps/public-intake/cloudflare/worker.mjs'), bindings,
    d1Databases: ['DB'], r2Buckets: ['ARTIFACTS'],
    outboundService: async request => {
      try {
        const response = await upstreamFetch(directory, tls, request, directoryHost);
        directoryResult = `HTTP ${response.status}`;
        return response;
      } catch (error) {
        directoryResult = error.code ?? error.name;
        throw error;
      }
    },
    serviceBindings: { ASSETS: siteAssets('customer', customerAssets, '/', 'portal.html') }
  });
  const portal = browserProxy(tls, mf, origin);
  const close = async () => {
    await Promise.all([portal, directory].map(server => new Promise(resolve => server.close(resolve))));
    await mf.dispose();
  };
  try {
    directory.listen(0, '127.0.0.1');
    await once(directory, 'listening');
    const db = await mf.getD1Database('DB'), artifacts = await mf.getR2Bucket('ARTIFACTS');
    for (const name of ['0001_trials.sql', '0003_customer_portal.sql', '0004_manual_customer_mail.sql']) {
      const sql = await readFile(join(repository, 'apps/public-intake/cloudflare/migrations', name), 'utf8');
      await db.batch(sql.split(';').map(statement => statement.trim()).filter(Boolean).map(statement => db.prepare(statement)));
    }
    const manualMail = async email => {
      const response = await handleRequest(new Request(`${adminOrigin}/api/access-admin/customer-mail`, {
        headers: { Authorization: `Bearer ${operatorToken}` }
      }), { ...bindings, PUBLIC_INTAKE_ORIGIN: adminOrigin, SITE_SURFACE: 'admin',
        OPERATOR_TOKEN: operatorToken, DB: db, ARTIFACTS: artifacts });
      assert.equal(response.status, 200);
      return (await response.json()).messages.find(message => message.to === email);
    };
    portal.listen(0, '127.0.0.1');
    await once(portal, 'listening');
    const start = email => mf.dispatchFetch(`${origin}/api/customer/start`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
    });
    return { origin, port: portal.address().port, manualMail, start, directoryResult: () => directoryResult, close };
  } catch (error) { await close(); throw error; }
}

export async function localCloudAdmin({ tls, pool, tokenKey, bridge }) {
  const serviceToken = randomBytes(32).toString('hex');
  const env = {
    ADMIN_ORIGIN: `https://${adminHost}`, CLOUD_ADMIN_ACCESS_ISSUER: 'https://local-fixture.cloudflareaccess.com',
    PUBLIC_INTAKE_ORIGIN: `https://${adminHost}`, CUSTOMER_ORIGIN: `https://${customerHost}`, SITE_SURFACE: 'admin',
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
  const localFetch = async request => {
    if (request.url === `${env.CLOUD_ADMIN_ACCESS_ISSUER}/cdn-cgi/access/certs`) {
      return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'fixture' }] });
    }
    return upstreamFetch(management, tls, request, managementHost);
  };
  const mf = new Miniflare({ ...workerOptions, scriptPath: join(repository, 'apps/public-intake/cloudflare/admin-worker.mjs'),
    bindings: env, outboundService: localFetch,
    serviceBindings: { ASSETS: siteAssets('admin', adminAssets, '/cloud-tenants', 'cloud-tenants.html') } });
  const portal = browserProxy(tls, mf, env.ADMIN_ORIGIN);
  const close = async () => {
    await Promise.all([portal, management].map(server => new Promise(resolve => server.close(resolve))));
    await mf.dispose();
  };
  try {
    management.listen(0, '127.0.0.1');
    await once(management, 'listening');
    portal.listen(0, '127.0.0.1');
    await once(portal, 'listening');
    return { assertion, close, origin: env.ADMIN_ORIGIN, port: portal.address().port };
  } catch (error) { await close(); throw error; }
}

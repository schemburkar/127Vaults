import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { containRequestErrors, HttpBoundaryError, parseJsonObject, readRequestBody, writeError, writeJson } from '../src/http-boundary.mjs';
import { readSecretFile } from '../src/runtime-config.mjs';
import { cloudDatabaseConfig } from './database-config.mjs';
import { cloudPublicOrigin, cloudTenantUrl, validCloudSlug } from './tenant-url.mjs';
import { activateCloudTenant, CloudOperatorError, issueCloudBootstrapToken, provisionCloudTenant, readCloudTenants,
  setCloudTenantSeatLimit, setCloudTenantSuspension, verifyCloudDatabase, verifyCloudManagementLogin } from './operator.mjs';

export async function createCloudManagementHandler({ pool, serviceToken, tokenKey, createOpaqueSetup, publicOrigin = cloudPublicOrigin }) {
  if (!/^[a-f0-9]{64}$/.test(serviceToken ?? '') || !Buffer.isBuffer(tokenKey) || tokenKey.length !== 32 ||
      typeof createOpaqueSetup !== 'function') {
    throw new Error('Cloud management configuration is incomplete.');
  }
  await verifyCloudManagementLogin(pool);
  await verifyCloudDatabase(pool, 'global');
  const authorization = Buffer.from(`Bearer ${serviceToken}`);
  const commands = new Map([
    ['list', [[], (client, input) => readCloudTenants(client, input)]],
    ['provision', [['slug', 'maxActiveUsers', 'ownerIdentityId', 'ownerEmail'], (client, input) => provisionCloudTenant(client, { ...input, createOpaqueSetup })]],
    ['issue-setup', [['slug'], async (client, input) => {
      const { id, setupUrl } = await issueCloudBootstrapToken(client, { ...input, tokenKey });
      return { id, setupUrl };
    }]],
    ['activate', [['slug'], activateCloudTenant]],
    ['suspend', [['slug'], (client, input) => setCloudTenantSuspension(client, { ...input, suspended: true })]],
    ['resume', [['slug'], (client, input) => setCloudTenantSuspension(client, { ...input, suspended: false })]],
    ['set-seats', [['slug', 'maxActiveUsers'], setCloudTenantSeatLimit]]
  ]);
  return async (req, res) => {
    const command = commands.get(/^\/internal\/cloud\/v1\/([a-z-]+)$/.exec(req.url)?.[1]);
    if (!command) return writeError(res, 404, 'not_found');
    if (req.method !== 'POST') return writeError(res, 405, 'method_not_allowed');
    const supplied = Buffer.from(req.headers.authorization ?? '');
    const actor = req.headers['x-127v-operator'];
    if (!req.socket?.encrypted || req.headers.origin !== undefined || supplied.length !== authorization.length ||
        !timingSafeEqual(supplied, authorization) || typeof actor !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_:@.-]{0,127}$/.test(actor)) {
      return writeError(res, 401, 'authentication_required');
    }
    const [fields, execute] = command;
    try {
      const input = parseJsonObject(req, await readRequestBody(req, 2048), fields);
      if (fields.includes('slug') && !validCloudSlug(input.slug)) {
        return writeError(res, 400, 'invalid_tenant_slug');
      }
      const client = await pool.connect();
      try { writeJson(res, 200, await execute(client, { ...input, region: 'global', actor, publicOrigin })); }
      finally { client.release(); }
    } catch (error) {
      if (error instanceof HttpBoundaryError) return writeError(res, error.status, error.code);
      if (error instanceof CloudOperatorError) return writeJson(res, 409, { error: 'operation_rejected', detail: error.message });
      throw error;
    }
  };
}

export async function createCloudManagementHttpsServer({ tls, onError, ...options }) {
  return createPrivateHttpsServer(tls, await createCloudManagementHandler(options), onError);
}

export function createCloudCustomerDirectoryHandler({ pool, customerDirectoryToken, publicOrigin = cloudPublicOrigin }) {
  if (!/^[a-f0-9]{64}$/.test(customerDirectoryToken ?? '')) throw new Error('Customer directory service token is required.');
  const authorization = Buffer.from(`Bearer ${customerDirectoryToken}`);
  return async (req, res) => {
    if (req.url !== '/internal/cloud/v1/customer-tenants') return writeError(res, 404, 'not_found');
    if (req.method !== 'POST') return writeError(res, 405, 'method_not_allowed');
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (!req.socket?.encrypted || req.headers.origin !== undefined || supplied.length !== authorization.length ||
        !timingSafeEqual(supplied, authorization)) return writeError(res, 401, 'authentication_required');
    try {
      const { email } = parseJsonObject(req, await readRequestBody(req, 2048), ['email']);
      if (typeof email !== 'string' || email !== email.toLowerCase() || !/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(email) || email.length > 254) {
        return writeError(res, 400, 'invalid_email');
      }
      const { rows } = await pool.query(`SELECT slug, state, max_active_users AS "maxActiveUsers" FROM cloud.tenants
        WHERE region = 'global' AND control_owner_email = $1 ORDER BY slug`, [email]);
      return writeJson(res, 200, { tenants: rows.map(row => ({ ...row, canonicalUrl: cloudTenantUrl(row.slug, publicOrigin) })) });
    } catch (error) {
      if (error instanceof HttpBoundaryError) return writeError(res, error.status, error.code);
      throw error;
    }
  };
}

export function createCloudCustomerDirectoryHttpsServer({ tls, onError, ...options }) {
  return createPrivateHttpsServer(tls, createCloudCustomerDirectoryHandler(options), onError);
}

function createPrivateHttpsServer(tls, handler, onError) {
  const server = createServer({ ...tls, minVersion: 'TLSv1.2', maxHeaderSize: 8192 }, containRequestErrors(handler, onError));
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.on('upgrade', (_req, socket) => socket.destroy());
  return server;
}

async function serve(env) {
  if (env.VAULTS_INTERNAL_CLOUD_OPERATIONS !== '1' || !env.VAULTS_DATABASE_HOST || !env.VAULTS_DATABASE_NAME ||
      env.VAULTS_DATABASE_NAME === 'vaults_experimental' || !env.VAULTS_DATABASE_USER) throw new Error('Dedicated Cloud management configuration is required.');
  const [cert, key, tokenKey] = await Promise.all([
    readFile(env.VAULTS_TLS_CERT), readFile(env.VAULTS_TLS_KEY), readFile(env.VAULTS_TOKEN_KEY_FILE)
  ]);
  const serviceToken = readSecretFile(env.VAULTS_CLOUD_MANAGEMENT_TOKEN_FILE, 'Management service token', /^[a-f0-9]{64}$/);
  const customerDirectoryToken = env.VAULTS_CLOUD_CUSTOMER_DIRECTORY_TOKEN_FILE ?
    readSecretFile(env.VAULTS_CLOUD_CUSTOMER_DIRECTORY_TOKEN_FILE, 'Customer directory token', /^[a-f0-9]{64}$/) : undefined;
  const generated = await import(pathToFileURL(env.VAULTS_OPAQUE_NODE_MODULE).href);
  if (typeof generated.default === 'function') await generated.default();
  const bridge = generated.ExperimentalOpaqueBridge;
  if (typeof bridge?.server_setup !== 'function') throw new Error('Cloud OPAQUE setup is unavailable.');
  const port = Number(env.VAULTS_CLOUD_MANAGEMENT_PORT ?? 8444);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid management HTTPS port.');
  const directoryPort = Number(env.VAULTS_CLOUD_CUSTOMER_DIRECTORY_PORT ?? 8445);
  if (customerDirectoryToken && (customerDirectoryToken === serviceToken || !Number.isInteger(directoryPort) ||
      directoryPort < 1 || directoryPort > 65535 || directoryPort === port)) {
    throw new Error('The customer directory requires a separate service token and HTTPS port.');
  }
  const pool = new pg.Pool({ ...await cloudDatabaseConfig(env), max: 2, connectionTimeoutMillis: 2000, statement_timeout: 10000 });
  pool.on('error', () => console.error('Cloud management database pool error.'));
  const servers = [];
  let closing;
  const close = () => closing ??= Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
    .then(() => pool.end());
  try {
    const server = await createCloudManagementHttpsServer({ tls: { cert, key }, pool, serviceToken, tokenKey,
      createOpaqueSetup: () => Buffer.from(bridge.server_setup()),
      onError: () => console.error('Cloud management request failed.') });
    servers.push(server);
    if (customerDirectoryToken) {
      servers.push(createCloudCustomerDirectoryHttpsServer({ tls: { cert, key }, pool, customerDirectoryToken,
        onError: () => console.error('Cloud customer directory request failed.') }));
    }
    await Promise.all(servers.map((listener, index) => {
      const ready = once(listener, 'listening');
      listener.listen(index === 0 ? port : directoryPort,
        (index === 0 ? env.VAULTS_CLOUD_MANAGEMENT_BIND : env.VAULTS_CLOUD_CUSTOMER_DIRECTORY_BIND) ?? '127.0.0.1');
      return ready;
    }));
    for (const listener of servers) listener.on('error', () => {
      console.error('Cloud management or directory listener failed.'); process.exitCode = 1; void close();
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void close());
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await serve(process.env);

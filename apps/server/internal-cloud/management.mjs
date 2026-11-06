import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { containRequestErrors, HttpBoundaryError, parseJsonObject, readRequestBody, writeError, writeJson } from '../src/http-boundary.mjs';
import { readSecretFile, runtimeDatabaseConfig } from '../src/runtime-config.mjs';
import { activateCloudTenant, CloudOperatorError, issueCloudBootstrapToken, provisionCloudTenant, readCloudTenants,
  setCloudTenantSeatLimit, setCloudTenantSuspension, verifyCloudDatabase, verifyCloudManagementLogin } from './operator.mjs';

export async function createCloudManagementHandler({ pool, serviceToken, tokenKey, createOpaqueSetup, tenantSuffix }) {
  if (!/^[a-f0-9]{64}$/.test(serviceToken ?? '') || !Buffer.isBuffer(tokenKey) || tokenKey.length !== 32 ||
      typeof createOpaqueSetup !== 'function' || !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(tenantSuffix ?? '')) {
    throw new Error('Cloud management configuration is incomplete.');
  }
  await verifyCloudManagementLogin(pool);
  await verifyCloudDatabase(pool, 'global');
  const authorization = Buffer.from(`Bearer ${serviceToken}`);
  const commands = new Map([
    ['list', [[], (client, input) => readCloudTenants(client, input)]],
    ['provision', [['host', 'maxActiveUsers', 'ownerIdentityId', 'ownerEmail'], (client, input) => provisionCloudTenant(client, { ...input, createOpaqueSetup })]],
    ['issue-setup', [['host'], async (client, input) => {
      const { id, setupUrl } = await issueCloudBootstrapToken(client, { ...input, tokenKey });
      return { id, setupUrl };
    }]],
    ['activate', [['host'], activateCloudTenant]],
    ['suspend', [['host'], (client, input) => setCloudTenantSuspension(client, { ...input, suspended: true })]],
    ['resume', [['host'], (client, input) => setCloudTenantSuspension(client, { ...input, suspended: false })]],
    ['set-seats', [['host', 'maxActiveUsers'], setCloudTenantSeatLimit]]
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
      if (fields.includes('host') && (typeof input.host !== 'string' || !input.host.endsWith(`.${tenantSuffix}`))) {
        return writeError(res, 400, 'invalid_tenant_host');
      }
      const client = await pool.connect();
      try { writeJson(res, 200, await execute(client, { ...input, region: 'global', actor })); }
      finally { client.release(); }
    } catch (error) {
      if (error instanceof HttpBoundaryError) return writeError(res, error.status, error.code);
      if (error instanceof CloudOperatorError) return writeJson(res, 409, { error: 'operation_rejected', detail: error.message });
      throw error;
    }
  };
}

async function serve(env) {
  if (env.VAULTS_INTERNAL_CLOUD_OPERATIONS !== '1' || !env.VAULTS_DATABASE_HOST || !env.VAULTS_DATABASE_NAME ||
      env.VAULTS_DATABASE_NAME === 'vaults_experimental' || !env.VAULTS_DATABASE_USER) throw new Error('Dedicated Cloud management configuration is required.');
  const [cert, key, tokenKey] = await Promise.all([
    readFile(env.VAULTS_TLS_CERT), readFile(env.VAULTS_TLS_KEY), readFile(env.VAULTS_TOKEN_KEY_FILE)
  ]);
  const serviceToken = readSecretFile(env.VAULTS_CLOUD_MANAGEMENT_TOKEN_FILE, 'Management service token', /^[a-f0-9]{64}$/);
  const generated = await import(pathToFileURL(env.VAULTS_OPAQUE_NODE_MODULE).href);
  if (typeof generated.default === 'function') await generated.default();
  const bridge = generated.ExperimentalOpaqueBridge;
  if (typeof bridge?.server_setup !== 'function') throw new Error('Cloud OPAQUE setup is unavailable.');
  const port = Number(env.VAULTS_CLOUD_MANAGEMENT_PORT ?? 8444);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid management HTTPS port.');
  const pool = new pg.Pool({ ...runtimeDatabaseConfig(env), max: 2, connectionTimeoutMillis: 2000, statement_timeout: 10000 });
  pool.on('error', () => console.error('Cloud management database pool error.'));
  try {
    const handler = await createCloudManagementHandler({ pool, serviceToken, tokenKey,
      createOpaqueSetup: () => Buffer.from(bridge.server_setup()), tenantSuffix: env.VAULTS_CLOUD_TENANT_SUFFIX });
    const server = createServer({ cert, key, minVersion: 'TLSv1.2', maxHeaderSize: 8192 },
      containRequestErrors(handler, () => console.error('Cloud management request failed.')));
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.on('upgrade', (_req, socket) => socket.destroy());
    server.on('error', () => { console.error('Cloud management listener failed.'); process.exitCode = 1; void pool.end(); });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => void pool.end()));
    server.listen(port, env.VAULTS_CLOUD_MANAGEMENT_BIND ?? '127.0.0.1');
  } catch (error) {
    await pool.end();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await serve(process.env);

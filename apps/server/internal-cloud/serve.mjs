import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { containRequestErrors, HttpBoundaryError, writeError } from '../src/http-boundary.mjs';
import { cloudDatabaseConfig } from './database-config.mjs';
import { createInternalCloudRuntimeBoundary } from './request-boundary.mjs';
import { createInternalCloudEnrollmentHandlers, createInternalCloudTenantHandlers } from './tenant-handlers.mjs';
import { cloudWebAssets } from './web-assets.mjs';
import { cloudInvitationMailer } from './invitation-mailer.mjs';
import { applyCloudTunnelIngress } from './tunnel-ingress.mjs';

export async function createCloudHttpsServer({ pool, tls, bridge, tokenKey, checkpointPrivateKey, mailer, tunnelIngress = false, onError }) {
  const checkpointPublicKey = createPublicKey(checkpointPrivateKey)
    .export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
  const dispatch = await createInternalCloudRuntimeBoundary({
    pool, region: 'global', webAssets: cloudWebAssets,
    handle: createInternalCloudTenantHandlers({ bridge, tokenKey, checkpointPrivateKey, checkpointPublicKey, mailer }),
    handleEnrollment: createInternalCloudEnrollmentHandlers({ bridge, tokenKey })
  });
  const server = createServer({ ...tls, minVersion: 'TLSv1.2', maxHeaderSize: 8192 }, containRequestErrors(async (req, res) => {
    try {
      if (tunnelIngress) applyCloudTunnelIngress(req);
      await dispatch(req, res);
    }
    catch (error) {
      if (!(error instanceof HttpBoundaryError)) throw error;
      writeError(res, error.status, error.code);
    }
  }, onError));
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.on('upgrade', (_req, socket) => socket.destroy());
  return server;
}

async function serve(env) {
  if (env.VAULTS_INTERNAL_CLOUD_OPERATIONS !== '1' || !env.VAULTS_DATABASE_HOST ||
      !env.VAULTS_DATABASE_NAME || env.VAULTS_DATABASE_NAME === 'vaults_experimental' ||
      !env.VAULTS_DATABASE_USER) throw new Error('Dedicated internal Cloud runtime configuration is required.');

  const [cert, key, tokenKey, seed] = await Promise.all([
    readFile(env.VAULTS_TLS_CERT), readFile(env.VAULTS_TLS_KEY),
    readFile(env.VAULTS_TOKEN_KEY_FILE), readFile(env.VAULTS_CHECKPOINT_KEY_FILE)
  ]);
  if (tokenKey.length !== 32 || seed.length !== 32) throw new Error('Cloud key files must contain exactly 32 bytes.');
  const checkpointPrivateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8'
  });
  seed.fill(0);
  const generated = await import(pathToFileURL(env.VAULTS_OPAQUE_NODE_MODULE).href);
  if (typeof generated.default === 'function') await generated.default();
  const bridge = generated.ExperimentalOpaqueBridge;
  if (!['server_public_key', 'server_login_start', 'server_login_finish', 'server_registration_start',
    'server_registration_finish'].every(method => typeof bridge?.[method] === 'function')) {
    throw new Error('Cloud OPAQUE bridge is incomplete.');
  }

  const port = Number(env.VAULTS_CLOUD_PORT ?? 8443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Cloud HTTPS port.');
  const bind = env.VAULTS_CLOUD_BIND ?? '127.0.0.1';
  const ingress = env.VAULTS_CLOUD_INGRESS ?? 'direct';
  if (!['direct', 'cloudflare-tunnel'].includes(ingress) || (ingress === 'cloudflare-tunnel' && bind !== '127.0.0.1')) {
    throw new Error('Cloudflare Tunnel ingress requires a private loopback listener.');
  }
  if (ingress !== 'direct' && env.VAULTS_CLOUD_INVITATION_MAIL === 'capture') throw new Error('Cloud mail capture requires direct local access.');
  const mailer = await cloudInvitationMailer(env);
  const pool = new pg.Pool({ ...await cloudDatabaseConfig(env), max: 4,
    connectionTimeoutMillis: 2000, statement_timeout: 2000 });
  pool.on('error', () => console.error('Cloud database pool error.'));
  try {
    const server = await createCloudHttpsServer({ pool, tls: { cert, key }, bridge, tokenKey, checkpointPrivateKey, mailer,
      tunnelIngress: ingress === 'cloudflare-tunnel',
      onError: () => console.error('Cloud request failed.') });
    server.on('error', () => { console.error('Cloud listener failed.'); process.exitCode = 1; void pool.end(); });
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => server.close(() => void pool.end()));
    }
    server.listen(port, bind, () => console.log('Internal Cloud HTTPS listener ready.'));
  } catch (error) {
    await pool.end();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await serve(process.env);
}

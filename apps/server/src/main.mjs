import { createServer } from 'node:https';
import { createPrivateKey, createPublicKey, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';
import pg from 'pg';
import { requireSchema, schemaVersion } from './schema.mjs';
import { requestAllowed, sniAllowed, transportConfig } from './transport.mjs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AuthService } from './auth-service.mjs';
import { createAuthHandler } from './auth-handler.mjs';
import { PgAuthStore } from './auth-pg.mjs';
import { OpaqueAdapter, RegistrationAdapter, createRegistrationCompletion } from './opaque-adapter.mjs';
import { OnboardingService } from './onboarding.mjs';
import { PgOnboardingStore } from './onboarding-pg.mjs';
import { createOnboardingHandler } from './onboarding-handler.mjs';
import { SmtpMailer } from './smtp.mjs';
import { PgPrivateVaultStore } from './private-vault-pg.mjs';
import { createPrivateVaultHandler } from './private-vault-handler.mjs';
import { PgVaultSettingsStore, createVaultSettingsHandler } from './vault-settings-handler.mjs';
import { PgVaultRemovalStore, createVaultRemovalHandler } from './vault-removal-handler.mjs';
import { PgSignedSyncStore } from './sync-pg.mjs';
import { createSignedSyncHandler } from './sync-handler.mjs';
import { PgDeviceLifecycleStore } from './device-lifecycle-pg.mjs';
import { createDeviceLifecycleHandler } from './device-lifecycle-handler.mjs';
import { createDeviceEnrollmentHandler } from './device-enrollment-handler.mjs';
import { readSecretFile, readinessToken, runtimeDatabaseConfig } from './runtime-config.mjs';
import { createOpsTelemetry } from './ops-log.mjs';
import { createAdminHandler } from './admin/handler.mjs';
import { loadOperators } from './admin/credentials.mjs';
import { PgAdminManagement } from './admin/management.mjs';
import { createOwnershipHandler } from './ownership-handler.mjs';
import { createLicenseHandler } from './license-handler.mjs';
import { loadLicenseStatus } from './license-status.mjs';
import { createLicenseWriteGuard } from './license-write-guard.mjs';
import { LicenseClock } from './license-clock.mjs';
import { createSetupHandler } from './setup-handler.mjs';

// Experimental internal MVP: use fictitious credentials and vault data only.
const env = process.env;
if (env.VAULTS_LICENSE_FILE && !env.VAULTS_LICENSE_CLOCK_FILE) throw Error('Licensed server requires a persistent clock path.');
const licenseClock = env.VAULTS_LICENSE_CLOCK_FILE ? new LicenseClock(env.VAULTS_LICENSE_CLOCK_FILE) : null;
const telemetry = createOpsTelemetry();
function fail(message) { throw new Error(message); }
if (env.VAULTS_EXPERIMENTAL !== '1') fail('Set VAULTS_EXPERIMENTAL=1; use disposable data only.');
const transport = transportConfig(env);
const { bind: host, port, authority } = transport;
const certPath = env.VAULTS_TLS_CERT ?? '/run/secrets/tls/server.crt';
const keyPath = env.VAULTS_TLS_KEY ?? '/run/secrets/tls/server.key';
let tls;
try {
  const cert = readFileSync(certPath);
  const key = readFileSync(keyPath);
  const context = createSecureContext({ cert, key, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3' });
  tls = { cert, key, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3', SNICallback(name, callback) {
    if (!sniAllowed(name, transport)) callback(new Error('Unrecognized TLS name'));
    else callback(null, context);
  } };
} catch { fail('Valid readable TLS certificate and key files are required; HTTP fallback is forbidden.'); }
const token = readinessToken(env);
const database = runtimeDatabaseConfig(env);
const pool = new pg.Pool({ ...database, max: 4,
  connectionTimeoutMillis: 2000, query_timeout: 2000, statement_timeout: 2000 });
pool.on('error', () => telemetry.event('database_pool_error'));
const tokenKeyPath=env.VAULTS_TOKEN_KEY_FILE;
const checkpointKeyPath=env.VAULTS_CHECKPOINT_KEY_FILE;
const opaqueModulePath=env.VAULTS_OPAQUE_NODE_MODULE;
if(!tokenKeyPath||!checkpointKeyPath||!opaqueModulePath) fail('Authentication, checkpoint, and OPAQUE configuration are required.');
const tokenKey=await readFile(tokenKeyPath).catch(()=>fail('Authentication token key must be readable.'));
if(tokenKey.length!==32)fail('Authentication token key must contain exactly 32 bytes.');
const checkpointSeed=await readFile(checkpointKeyPath).catch(()=>fail('Checkpoint signing key must be readable.'));
if(checkpointSeed.length!==32)fail('Checkpoint signing key must contain exactly 32 bytes.');
const checkpointPrivateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),checkpointSeed]),format:'der',type:'pkcs8'});
const checkpointPublicKey=Buffer.from(createPublicKey(checkpointPrivateKey).export({format:'der',type:'spki'})).subarray(-32).toString('base64url');
const generated=await import(pathToFileURL(opaqueModulePath).href).catch(()=>fail('Reviewed Node OPAQUE module is required.'));
if(typeof generated.default==='function')await generated.default();
const Bridge=generated.ExperimentalOpaqueBridge;
if(!Bridge)fail('Reviewed Node OPAQUE bridge export is required.');
const opaque=new OpaqueAdapter(Bridge);
let setup=(await pool.query('SELECT setup_bytes FROM vaults.opaque_server_setup LIMIT 1').catch(()=>({rows:[]}))).rows[0]?.setup_bytes;
if(!setup){setup=Buffer.from(Bridge.server_setup());const tenant=(await pool.query('SELECT id FROM vaults.installation WHERE singleton=true')).rows[0]?.id;if(!tenant)fail('Installation is not initialized.');await pool.query('INSERT INTO vaults.opaque_server_setup(tenant_id,setup_bytes) VALUES($1,$2) ON CONFLICT DO NOTHING',[tenant,setup]);}
const publicKey=Buffer.from(Bridge.server_public_key(setup));
const authService=new AuthService({store:new PgAuthStore(pool,tokenKey,publicKey),opaque});
const installation=(await pool.query('SELECT id FROM vaults.installation WHERE singleton=true')).rows[0].id;
const registration=new RegistrationAdapter({opaque,setup,installation,serverPublicKey:publicKey,tokenKey,origin:transport.origin});
const authHandler=createAuthHandler(authService,transport.origin);
let mailer;
if (env.SMTP_HOST) {
  const password = readSecretFile(env.SMTP_PASSWORD_FILE, 'SMTP password', /^[\x21-\x7e]{1,512}$/,
    { allowVirtualizedPermissions: env.VAULTS_ALLOW_VIRTUALIZED_SECRET_PERMISSIONS === '1' });
  mailer = new SmtpMailer({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 465), username: env.SMTP_USERNAME,
    password, from: env.SMTP_FROM, installationLabel: env.VAULTS_INSTALLATION_LABEL });
} else mailer = { sendCode: async () => { throw new Error('SMTP unavailable.'); } };
const loadEntitlement = async (tenantId, now) => loadLicenseStatus({licenseFile:env.VAULTS_LICENSE_FILE,
  publicKeyFile:env.VAULTS_LICENSE_PUBLIC_KEYS_FILE,revocationFile:env.VAULTS_LICENSE_REVOCATION_FILE,
  installationId:tenantId,now,clock:licenseClock});
const onboardingService=new OnboardingService({store:new PgOnboardingStore(pool,{loadEntitlement}),mailer,tokenKey});
const onboardingHandler=createOnboardingHandler(onboardingService,createRegistrationCompletion(opaque,registration),transport.origin,token=>authService.authenticate(token),registration);
const authenticate=token=>authService.authenticate(token);
const syncStore=new PgSignedSyncStore(pool,checkpointPrivateKey);
const privateVaultHandler=createPrivateVaultHandler(new PgPrivateVaultStore(pool,syncStore),authenticate,transport.origin);
const vaultSettingsHandler=createVaultSettingsHandler(new PgVaultSettingsStore(pool),authenticate,transport.origin);
const vaultRemovalHandler=createVaultRemovalHandler(new PgVaultRemovalStore(pool),authenticate,transport.origin);
const syncHandler=createSignedSyncHandler(syncStore,authenticate,transport.origin,{checkpointPublicKey});
const deviceStore=new PgDeviceLifecycleStore(pool);
const deviceLifecycleHandler=createDeviceLifecycleHandler(deviceStore,authenticate,transport.origin);
const deviceEnrollmentHandler=createDeviceEnrollmentHandler(deviceStore,authenticate,transport.origin);
const adminManagement=new PgAdminManagement(pool,{tokenKey,loadEntitlement});
const ownershipHandler=createOwnershipHandler(adminManagement,authenticate,transport.origin);
const adminHandler=createAdminHandler({pool,operators:loadOperators(env.VAULTS_ADMIN_OPERATORS_FILE,{allowVirtualizedPermissions:env.VAULTS_ALLOW_VIRTUALIZED_SECRET_PERMISSIONS==='1'}),origin:transport.origin,localOnly:transport.mode==='loopback',schemaVersion,management:adminManagement});
const licenseHandler=createLicenseHandler({pool,authenticate,origin:transport.origin,licenseFile:env.VAULTS_LICENSE_FILE,publicKeyFile:env.VAULTS_LICENSE_PUBLIC_KEYS_FILE,revocationFile:env.VAULTS_LICENSE_REVOCATION_FILE,clock:licenseClock});
const setupHandler=createSetupHandler({pool,origin:transport.origin,licenseFile:env.VAULTS_LICENSE_FILE,
  publicKeyFile:env.VAULTS_LICENSE_PUBLIC_KEYS_FILE,revocationFile:env.VAULTS_LICENSE_REVOCATION_FILE,
  smtpConfigured:Boolean(env.SMTP_HOST),clock:licenseClock});
const licenseWriteGuard=createLicenseWriteGuard({pool,authenticate,origin:transport.origin,
  licenseFile:env.VAULTS_LICENSE_FILE,publicKeyFile:env.VAULTS_LICENSE_PUBLIC_KEYS_FILE,
  revocationFile:env.VAULTS_LICENSE_REVOCATION_FILE,clock:licenseClock});
const webFiles=new Map([
  ['/', ['../../web/dist/index.html','text/html; charset=utf-8']],
  ['/sw.js',['../../web/dist/sw.js','text/javascript; charset=utf-8']],
  ['/manifest.webmanifest',['../../web/dist/manifest.webmanifest','application/manifest+json']],
  ['/icons/icon-192.png',['../../web/dist/icons/icon-192.png','image/png']],
  ['/icons/icon-512.png',['../../web/dist/icons/icon-512.png','image/png']],
  ['/icons/apple-touch-icon.png',['../../web/dist/icons/apple-touch-icon.png','image/png']],
  ['/app/react-client.js',['../../web/dist/app/react-client.js','text/javascript; charset=utf-8']],
  ['/app/react-style.css',['../../web/dist/app/react-style.css','text/css; charset=utf-8']],
  ['/legacy',['../../web/mvp.html','text/html; charset=utf-8']],
  ['/app/style.css',['../../web/style.css','text/css; charset=utf-8']],
  ['/app/mvp-client.mjs',['../../web/mvp-client.mjs','text/javascript; charset=utf-8']],
  ['/app/pwa-replica.mjs',['../../web/src/pwa-replica.mjs','text/javascript; charset=utf-8']],
  ['/app/browser-enrollment.mjs',['../../web/src/browser-enrollment.mjs','text/javascript; charset=utf-8']],
  ['/app/vault-lifecycle.mjs',['../../web/src/vault-lifecycle.mjs','text/javascript; charset=utf-8']],
  ['/app/signed-sync.mjs',['../../web/src/signed-sync.mjs','text/javascript; charset=utf-8']],
  ['/app/passkeys.mjs',['../../extension/src/passkeys.mjs','text/javascript; charset=utf-8']],
  ['/app/private-vault-client.mjs',['../../web/src/private-vault-client.mjs','text/javascript; charset=utf-8']],
  ['/wasm/vaults_browser_fixture.js',['../../web/wasm/vaults_browser_fixture.js','text/javascript; charset=utf-8']],
  ['/wasm/vaults_browser_fixture_bg.wasm',['../../web/wasm/vaults_browser_fixture_bg.wasm','application/wasm']]
]);
let stopping = false;
const server = createServer(tls, async (req, res) => {
  const began = Date.now();
  res.once('finish', () => telemetry.request(req.method, res.statusCode, Date.now() - began, !req.url?.startsWith('/health/')));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!requestAllowed(req, transport)) {
    reply(403, { error: 'forbidden' }); return;
  }
  if (stopping) { reply(503, { status: 'unavailable' }); return; }
  if(await adminHandler(req,res))return;
  if(await ownershipHandler(req,res))return;
  if(await setupHandler(req,res))return;
  const webUrl = new URL(req.url, transport.origin);
  const asset=webFiles.get(webUrl.pathname === '/' ? '/' : req.url);
  if(asset&&['GET','HEAD'].includes(req.method)){
    try{const bytes=await readFile(new URL(asset[0],import.meta.url));res.writeHead(200,{
      'Content-Type':asset[1],
      'Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; manifest-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()'
    });res.end(req.method==='HEAD'?undefined:bytes)}catch{reply(503,{error:'web_assets_unavailable'})}return;
  }
  if(await authHandler(req,res))return;
  if(await licenseWriteGuard(req,res))return;
  if(await onboardingHandler(req,res))return;
  if(await licenseHandler(req,res))return;
  if(await deviceEnrollmentHandler(req,res))return;
  if(await deviceLifecycleHandler(req,res))return;
  if(await syncHandler(req,res))return;
  if(await privateVaultHandler(req,res))return;
  if(await vaultRemovalHandler(req,res))return;
  if(await vaultSettingsHandler(req,res))return;
  if (req.method !== 'GET') { reply(405, { error: 'method_not_allowed' }); return; }
  if (req.url === '/health/live') { reply(200, { status: 'ok' }); return; }
  if (req.url !== '/health/ready') { reply(404, { error: 'not_found' }); return; }
  const supplied = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    reply(401, { error: 'unauthorized' }); return;
  }
  try {
    await requireSchema(pool);
    reply(200, { status: 'ok', experimental: true, schemaVersion, scope: 'schema-only', ops: telemetry.snapshot() });
  } catch { reply(503, { status: 'unavailable' }); }
});
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.keepAliveTimeout = 1000;
server.maxHeadersCount = 32;
server.on('upgrade', (_req, socket) => socket.destroy());
server.on('error', () => { telemetry.event('listener_error'); process.exit(1); });
server.listen(port, host, () => telemetry.event('server_started'));
async function shutdown() {
  if (stopping) return;
  stopping = true;
  telemetry.event('server_stopping');
  const deadline = setTimeout(() => process.exit(1), 8000);
  deadline.unref();
  server.close(async () => {
    try { await pool.end(); clearTimeout(deadline); }
    catch { process.exitCode = 1; }
  });
  server.closeIdleConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

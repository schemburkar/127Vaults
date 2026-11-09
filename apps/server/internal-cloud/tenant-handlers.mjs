// Internal Cloud API composition. This is not imported by the self-hosted
// executable and is not copied into its image. Every store receives the pool
// created by the verified regional request boundary.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthService } from '../src/auth-service.mjs';
import { createAuthHandler } from '../src/auth-handler.mjs';
import { PgAuthStore } from '../src/auth-pg.mjs';
import { OpaqueAdapter, RegistrationAdapter, createRegistrationCompletion } from '../src/opaque-adapter.mjs';
import { OnboardingService } from '../src/onboarding.mjs';
import { PgOnboardingStore } from '../src/onboarding-pg.mjs';
import { createOnboardingHandler } from '../src/onboarding-handler.mjs';
import { PgPrivateVaultStore } from '../src/private-vault-pg.mjs';
import { createPrivateVaultHandler } from '../src/private-vault-handler.mjs';
import { PgVaultSettingsStore, createVaultSettingsHandler } from '../src/vault-settings-handler.mjs';
import { PgVaultRemovalStore, createVaultRemovalHandler } from '../src/vault-removal-handler.mjs';
import { PgSignedSyncStore } from '../src/sync-pg.mjs';
import { createSignedSyncHandler } from '../src/sync-handler.mjs';
import { PgDeviceLifecycleStore } from '../src/device-lifecycle-pg.mjs';
import { PgCredentialRotationStore, createCredentialRotationHandler } from '../src/credential-rotation.mjs';
import { createDeviceLifecycleHandler } from '../src/device-lifecycle-handler.mjs';
import { createDeviceEnrollmentHandler } from '../src/device-enrollment-handler.mjs';
import { writeError, writeJson } from '../src/http-boundary.mjs';
import { createCloudFamilyHandler } from './family-handler.mjs';

function tenantCeremony(tokenKey, tenantId) {
  const mac = nonce => createHmac('sha256', tokenKey).update('127vaults Cloud ceremony v1\0').update(tenantId).update(nonce).digest().subarray(0, 16);
  return {
    issueCeremony() {
      const nonce = randomBytes(16);
      return Buffer.concat([nonce, mac(nonce)]).toString('base64url');
    },
    readCeremony(value) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(value ?? '')) return undefined;
      const bytes = Buffer.from(value, 'base64url');
      if (bytes.toString('base64url') === value && timingSafeEqual(mac(bytes.subarray(0, 16)), bytes.subarray(16))) return value;
      return undefined;
    }
  };
}

async function loadEnrollmentEntitlement(tenantId, _now, transaction) {
  const result = await transaction.query('SELECT cloud.enrollment_seat_limit($1) AS seat_limit', [tenantId]);
  const maxActiveUsers = result.rows[0]?.seat_limit;
  if (!Number.isInteger(maxActiveUsers) || maxActiveUsers < 1) throw new Error('Cloud seat limit unavailable.');
  return { mode: 'active', maxActiveUsers };
}

export function createInternalCloudTenantHandlers({ bridge, tokenKey, checkpointPrivateKey, checkpointPublicKey, mailer }) {
  if (!bridge || !Buffer.isBuffer(tokenKey) || tokenKey.length !== 32 || !checkpointPrivateKey ||
      typeof checkpointPublicKey !== 'string') throw new Error('Cloud authentication and checkpoint keys required.');
  const opaque = new OpaqueAdapter(bridge);
  return async function handle(req, res, context) {
    const { tenant, origin, canonicalUrl, pool } = context;
    const setup = (await pool.query('SELECT setup_bytes FROM vaults.opaque_server_setup WHERE tenant_id=$1', [tenant.id])).rows[0]?.setup_bytes;
    if (!setup) throw new Error('Cloud tenant authentication setup is unavailable.');
    const publicKey = Buffer.from(bridge.server_public_key(setup));
    if (new URL(req.url, origin).pathname === '/api/v1/cloud/discovery') {
      if (req.method !== 'GET') writeError(res, 405, 'method_not_allowed');
      else writeJson(res, 200, { version: 1, tenantId: tenant.id, canonicalOrigin: origin, canonicalUrl,
        region: tenant.region, protocolVersions: { api: 1, sync: 1 },
        serverPublicKey: publicKey.toString('base64url'), checkpointPublicKey });
      return true;
    }
    const authService = new AuthService({ store: new PgAuthStore(pool, tokenKey, publicKey, { tenantId: tenant.id }), opaque });
    const ceremony = tenantCeremony(tokenKey, tenant.id);
    const authenticate = async token => context.requirePrincipal(await authService.authenticate(token));
    const onboarding = new OnboardingService({
      store: new PgOnboardingStore(pool, { tenantId: tenant.id, loadEntitlement: loadEnrollmentEntitlement }), mailer, tokenKey
    });
    const registration = new RegistrationAdapter({ opaque, setup, installation: tenant.id, serverPublicKey: publicKey, tokenKey, origin, authorizeStart: input => onboarding.authorizeRegistration(input) });
    const syncStore = new PgSignedSyncStore(pool, checkpointPrivateKey);
    const deviceStore = new PgDeviceLifecycleStore(pool,{tenantId:tenant.id});
    const handlers = [
      createAuthHandler(authService, origin, ceremony),
      createCloudFamilyHandler({ pool, tenantId: tenant.id, origin, authenticate, loadEntitlement: loadEnrollmentEntitlement,
        invitationsEnabled: Boolean(mailer) }),
      ...(mailer ? [createOnboardingHandler(onboarding, createRegistrationCompletion(opaque, registration), origin, authenticate, registration, ceremony)] : []),
      createDeviceEnrollmentHandler(deviceStore, authenticate, origin),
      createCredentialRotationHandler({store:new PgCredentialRotationStore(pool),authenticate,origin,registration,opaque}),
      createDeviceLifecycleHandler(deviceStore, authenticate, origin),
      createSignedSyncHandler(syncStore, authenticate, origin, { checkpointPublicKey }),
      createPrivateVaultHandler(new PgPrivateVaultStore(pool, syncStore), authenticate, origin),
      createVaultRemovalHandler(new PgVaultRemovalStore(pool), authenticate, origin),
      createVaultSettingsHandler(new PgVaultSettingsStore(pool), authenticate, origin)
    ];
    for (const handler of handlers) if (await handler(req, res)) return true;
    // Billing, licensing, and operator administration are not mounted here.
    writeError(res, 404, 'not_found');
    return true;
  };
}

// Mounted only behind the prepared-tenant boundary. That boundary admits just
// the ceremony and first-owner registration routes.
export function createInternalCloudEnrollmentHandlers({ bridge, tokenKey }) {
  if (!bridge || !Buffer.isBuffer(tokenKey) || tokenKey.length !== 32) {
    throw new Error('Cloud owner enrollment configuration required.');
  }
  const opaque = new OpaqueAdapter(bridge);
  return async function handle(req, res, context) {
    const { tenant, origin, pool } = context;
    const setup = (await pool.query('SELECT setup_bytes FROM vaults.opaque_server_setup WHERE tenant_id=$1', [tenant.id])).rows[0]?.setup_bytes;
    if (!setup) throw new Error('Cloud tenant authentication setup is unavailable.');
    const publicKey = Buffer.from(bridge.server_public_key(setup));
    const service = new AuthService({ store: new PgAuthStore(pool, tokenKey, publicKey, { tenantId: tenant.id }), opaque });
    const onboarding = new OnboardingService({ store: new PgOnboardingStore(pool, { tenantId: tenant.id, loadEntitlement: loadEnrollmentEntitlement }),
      mailer: { sendCode: async () => { throw new Error('Cloud email is unavailable.'); } }, tokenKey });
    const registration = new RegistrationAdapter({ opaque, setup, installation: tenant.id, serverPublicKey: publicKey, tokenKey, origin, authorizeStart: input => onboarding.authorizeRegistration(input) });
    const ceremony = tenantCeremony(tokenKey, tenant.id);
    const handlers = [createAuthHandler(service, origin, ceremony),
      createOnboardingHandler(onboarding, createRegistrationCompletion(opaque, registration), origin,
        async () => { throw new Error('Authentication unavailable during Cloud owner enrollment.'); }, registration, ceremony)];
    for (const handler of handlers) if (await handler(req, res)) return true;
    writeError(res, 404, 'not_found');
    return true;
  };
}

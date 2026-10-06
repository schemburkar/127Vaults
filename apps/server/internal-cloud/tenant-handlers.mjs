// Internal Cloud API composition. This is not imported by the self-hosted
// executable and is not copied into its image. Every store receives the pool
// created by the verified regional request boundary.
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
import { createDeviceLifecycleHandler } from '../src/device-lifecycle-handler.mjs';
import { createDeviceEnrollmentHandler } from '../src/device-enrollment-handler.mjs';
import { writeError, writeJson } from '../src/http-boundary.mjs';

export function createInternalCloudTenantHandlers({ bridge, tokenKey, checkpointPrivateKey, checkpointPublicKey, mailer }) {
  if (!bridge || !Buffer.isBuffer(tokenKey) || tokenKey.length !== 32 || !checkpointPrivateKey ||
      typeof checkpointPublicKey !== 'string') throw new Error('Cloud authentication and checkpoint keys required.');
  const opaque = new OpaqueAdapter(bridge);
  return async function handle(req, res, context) {
    const { tenant, origin, pool } = context;
    const setup = (await pool.query('SELECT setup_bytes FROM vaults.opaque_server_setup WHERE tenant_id=$1', [tenant.id])).rows[0]?.setup_bytes;
    if (!setup) throw new Error('Cloud tenant authentication setup is unavailable.');
    const publicKey = Buffer.from(bridge.server_public_key(setup));
    if (new URL(req.url, origin).pathname === '/api/v1/cloud/discovery') {
      if (req.method !== 'GET') writeError(res, 405, 'method_not_allowed');
      else writeJson(res, 200, { version: 1, tenantId: tenant.id, canonicalOrigin: origin,
        region: tenant.region, protocolVersions: { api: 1, sync: 1 },
        serverPublicKey: publicKey.toString('base64url'), checkpointPublicKey });
      return true;
    }
    const authService = new AuthService({ store: new PgAuthStore(pool, tokenKey, publicKey, { tenantId: tenant.id }), opaque });
    const authenticate = async token => context.requirePrincipal(await authService.authenticate(token));
    const registration = new RegistrationAdapter({ opaque, setup, installation: tenant.id, serverPublicKey: publicKey, tokenKey, origin });
    const syncStore = new PgSignedSyncStore(pool, checkpointPrivateKey);
    const deviceStore = new PgDeviceLifecycleStore(pool);
    const handlers = [
      createAuthHandler(authService, origin),
      ...(mailer ? [createOnboardingHandler(new OnboardingService({
        store: new PgOnboardingStore(pool, { tenantId: tenant.id }), mailer, tokenKey
      }), createRegistrationCompletion(opaque, registration), origin, authenticate, registration)] : []),
      createDeviceEnrollmentHandler(deviceStore, authenticate, origin),
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
    const registration = new RegistrationAdapter({ opaque, setup, installation: tenant.id, serverPublicKey: publicKey, tokenKey, origin });
    const onboarding = new OnboardingService({ store: new PgOnboardingStore(pool, { tenantId: tenant.id }),
      mailer: { sendCode: async () => { throw new Error('Cloud email is unavailable.'); } }, tokenKey });
    const handlers = [createAuthHandler(service, origin),
      createOnboardingHandler(onboarding, createRegistrationCompletion(opaque, registration), origin,
        async () => { throw new Error('Authentication unavailable during Cloud owner enrollment.'); }, registration)];
    for (const handler of handlers) if (await handler(req, res)) return true;
    writeError(res, 404, 'not_found');
    return true;
  };
}

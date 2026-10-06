import { cloudRequestHost, cloudTenantDirectory, requireTenantPrincipal, resolveCloudTenant } from '../src/tenant-context.mjs';
import { schemaChecksum } from '../src/schema.mjs';
import { overlayChecksum } from './operator.mjs';
import { createTenantScopedPool, verifyCloudRuntimeRole } from './scoped-pool.mjs';

// No listener is created here. Both boundaries remain internal until every
// mounted route and operational dependency has passed Cloud release gates.
async function createBoundary({ pool, region, handle, enrollmentOnly }) {
  if (typeof handle !== 'function') throw new Error('Cloud request handler required.');
  await verifyCloudRuntimeRole(pool);
  const manifest = (await pool.query('SELECT version,region,base_checksum,overlay_checksum FROM cloud.schema_manifest')).rows;
  if (manifest.length !== 1 || Number(manifest[0].version) !== 1 || manifest[0].region !== region ||
      manifest[0].base_checksum !== schemaChecksum || manifest[0].overlay_checksum !== overlayChecksum) {
    throw new Error('Unknown or changed regional Cloud schema.');
  }
  await pool.query('SELECT cloud.verify_rls()');
  return async function dispatch(req, res) {
    if (req.socket?.encrypted !== true) throw new Error('Cloud request requires TLS.');
    const host = cloudRequestHost(req);
    if (req.socket.servername !== host) throw new Error('Cloud SNI mismatch.');
    if (enrollmentOnly && !((req.method === 'GET' && req.url === '/api/v1/ceremony') ||
      (req.method === 'POST' && req.url === '/api/v1/onboarding/register'))) {
      throw new Error('Cloud enrollment route is unavailable.');
    }
    const found = (await pool.query(enrollmentOnly
      ? 'SELECT cloud.resolve_prepared_tenant($1,$2) AS id'
      : 'SELECT cloud.resolve_tenant($1,$2) AS id', [host, region])).rows[0]?.id;
    if (!found) throw new Error('Unknown or inactive tenant.');
    const directory = cloudTenantDirectory([{ id: found, host, region, state: enrollmentOnly ? 'prepared' : 'active' }], region);
    const tenant = enrollmentOnly ? directory.lookup(host) : resolveCloudTenant(req, directory);
    const scopedPool = createTenantScopedPool(pool, tenant.id);
    const context = Object.freeze({ tenant, origin: `https://${host}`, pool: scopedPool,
      requirePrincipal: principal => requireTenantPrincipal(tenant, principal) });
    return handle(req, res, context);
  };
}

export const createInternalCloudRequestBoundary = options => createBoundary({ ...options, enrollmentOnly: false });
export const createInternalCloudEnrollmentBoundary = options => createBoundary({ ...options, enrollmentOnly: true });

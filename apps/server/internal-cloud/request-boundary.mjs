import { cloudRequestHost, cloudTenantDirectory, requireTenantPrincipal, resolveCloudTenant } from '../src/tenant-context.mjs';
import { schemaChecksum } from '../src/schema.mjs';
import { overlayChecksum } from './operator.mjs';
import { createTenantScopedPool, verifyCloudRuntimeRole } from './scoped-pool.mjs';
import { HttpBoundaryError, writeJson } from '../src/http-boundary.mjs';
import { cloudLandingHost, serveCloudLanding } from './landing.mjs';

// No listener is created here. Both boundaries remain internal until every
// mounted route and operational dependency has passed Cloud release gates.
async function createBoundary({ pool, region, handle, enrollmentOnly, handleEnrollment, webAssets }) {
  if (typeof handle !== 'function') throw new Error('Cloud request handler required.');
  await verifyCloudRuntimeRole(pool);
  const manifest = (await pool.query('SELECT version,region,base_checksum,overlay_checksum FROM cloud.schema_manifest')).rows;
  if (manifest.length !== 1 || Number(manifest[0].version) !== 1 || manifest[0].region !== region ||
      manifest[0].base_checksum !== schemaChecksum || manifest[0].overlay_checksum !== overlayChecksum) {
    throw new Error('Unknown or changed regional Cloud schema.');
  }
  await pool.query('SELECT cloud.verify_rls()');
  return async function dispatch(req, res) {
    if (req.socket?.encrypted !== true) throw new HttpBoundaryError();
    let host;
    try { host = cloudRequestHost(req); }
    catch { throw new HttpBoundaryError(); }
    if (req.socket.servername !== host) throw new HttpBoundaryError();
    if (handleEnrollment && host === cloudLandingHost) {
      if (req.method === 'GET' && req.url === '/healthz') {
        await pool.query('SELECT 1');
        writeJson(res, 200, { status: 'ready' });
        return true;
      }
      return serveCloudLanding(req, res);
    }
    const asset = webAssets?.match(req);
    const setupStatus = handleEnrollment && req.method === 'GET' && req.url === '/api/v1/setup';
    const enrollmentRoute = asset || setupStatus || (req.method === 'GET' && req.url === '/api/v1/ceremony') ||
      (req.method === 'POST' && req.url === '/api/v1/onboarding/register');
    if (enrollmentOnly && !enrollmentRoute) {
      throw new Error('Cloud enrollment route is unavailable.');
    }
    let prepared = enrollmentOnly;
    let found = enrollmentOnly ? null : (await pool.query('SELECT cloud.resolve_tenant($1,$2) AS id', [host, region])).rows[0]?.id;
    if (!found && (enrollmentOnly || (handleEnrollment && enrollmentRoute))) {
      prepared = true;
      found = (await pool.query('SELECT cloud.resolve_prepared_tenant($1,$2) AS id', [host, region])).rows[0]?.id;
    }
    if (!found) {
      if (handleEnrollment) throw new HttpBoundaryError(404, 'not_found');
      throw new Error('Unknown or inactive tenant.');
    }
    if (asset) return webAssets.serve(req, res, asset);
    const directory = cloudTenantDirectory([{ id: found, host, region, state: prepared ? 'prepared' : 'active' }], region);
    const tenant = prepared ? directory.lookup(host) : resolveCloudTenant(req, directory);
    const scopedPool = createTenantScopedPool(pool, tenant.id);
    if (setupStatus) {
      const ownerExists = prepared && (await scopedPool.query(
        "SELECT EXISTS (SELECT 1 FROM vaults.accounts WHERE tenant_id=$1 AND server_role='owner') AS owner_exists", [tenant.id]
      )).rows[0].owner_exists;
      writeJson(res, 200, { deployment: 'cloud', ownerRequired: prepared && !ownerExists, activationPending: ownerExists });
      return true;
    }
    const context = Object.freeze({ tenant, origin: `https://${host}`, pool: scopedPool,
      requirePrincipal: principal => requireTenantPrincipal(tenant, principal) });
    return (prepared && handleEnrollment ? handleEnrollment : handle)(req, res, context);
  };
}

export const createInternalCloudRequestBoundary = options => createBoundary({ ...options, enrollmentOnly: false });
export const createInternalCloudEnrollmentBoundary = options => createBoundary({ ...options, enrollmentOnly: true });
export const createInternalCloudRuntimeBoundary = options => createBoundary({ ...options, enrollmentOnly: false });

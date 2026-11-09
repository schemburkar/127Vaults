import { cloudRequestHost, requireTenantPrincipal } from '../src/tenant-context.mjs';
import { schemaChecksum } from '../src/schema.mjs';
import { overlayChecksum } from './operator.mjs';
import { createTenantScopedPool, verifyCloudRuntimeRole } from './scoped-pool.mjs';
import { HttpBoundaryError, writeJson } from '../src/http-boundary.mjs';
import { serveCloudLanding } from './landing.mjs';
import { cloudPublicOrigin, cloudTenantUrl, splitCloudTenantRoute } from './tenant-url.mjs';

// No listener is created here. Both boundaries remain internal until every
// mounted route and operational dependency has passed Cloud release gates.
async function createBoundary({ pool, region, handle, enrollmentOnly, handleEnrollment, webAssets, publicOrigin = cloudPublicOrigin }) {
  if (typeof handle !== 'function') throw new Error('Cloud request handler required.');
  await verifyCloudRuntimeRole(pool);
  const manifest = (await pool.query('SELECT version,region,base_checksum,overlay_checksum FROM cloud.schema_manifest')).rows;
  if (manifest.length !== 1 || Number(manifest[0].version) !== 1 || manifest[0].region !== region ||
      manifest[0].base_checksum !== schemaChecksum || manifest[0].overlay_checksum !== overlayChecksum) {
    throw new Error('Unknown or changed regional Cloud schema.');
  }
  await pool.query('SELECT cloud.verify_rls()');
  const publicHost = new URL(publicOrigin).hostname;
  return async function dispatch(req, res) {
    if (req.socket?.encrypted !== true) throw new HttpBoundaryError();
    let host;
    try { host = cloudRequestHost(req); }
    catch { throw new HttpBoundaryError(); }
    if (req.socket.servername !== host) throw new HttpBoundaryError();
    if (host !== publicHost) throw new HttpBoundaryError(404, 'not_found');
    const selected = splitCloudTenantRoute(req.url);
    if (!selected && handleEnrollment) {
      if (req.method === 'GET' && req.url === '/healthz') {
        await pool.query('SELECT 1');
        writeJson(res, 200, { status: 'ready' });
        return true;
      }
      const asset = webAssets?.match(req);
      if (asset && !['index.html', 'sw.js', 'manifest.webmanifest'].includes(asset)) return webAssets.serve(req, res, asset);
      return serveCloudLanding(req, res);
    }
    if (!selected) throw new HttpBoundaryError(404, 'not_found');
    const { slug, route } = selected;
    req.url = route;
    const matchedAsset = webAssets?.match(req);
    const asset = ['index.html', 'sw.js', 'manifest.webmanifest'].includes(matchedAsset) ? matchedAsset : null;
    const setupStatus = handleEnrollment && req.method === 'GET' && req.url === '/api/v1/setup';
    const enrollmentRoute = asset || setupStatus || (req.method === 'GET' && req.url === '/api/v1/ceremony') ||
      (req.method === 'POST' && req.url === '/api/v1/onboarding/register');
    if (enrollmentOnly && !enrollmentRoute) {
      throw new Error('Cloud enrollment route is unavailable.');
    }
    let prepared = enrollmentOnly;
    let found = enrollmentOnly ? null : (await pool.query('SELECT cloud.resolve_tenant($1,$2) AS id', [slug, region])).rows[0]?.id;
    if (!found && (enrollmentOnly || (handleEnrollment && enrollmentRoute))) {
      prepared = true;
      found = (await pool.query('SELECT cloud.resolve_prepared_tenant($1,$2) AS id', [slug, region])).rows[0]?.id;
    }
    if (!found) {
      if (handleEnrollment) throw new HttpBoundaryError(404, 'not_found');
      throw new Error('Unknown or inactive tenant.');
    }
    if (asset) return webAssets.serve(req, res, asset, `/t/${slug}/`);
    const tenant = Object.freeze({ id: found, slug, region, state: prepared ? 'prepared' : 'active' });
    const canonicalUrl = cloudTenantUrl(slug, publicOrigin);
    const scopedPool = createTenantScopedPool(pool, tenant.id);
    if (setupStatus) {
      const ownerExists = prepared && (await scopedPool.query(
        "SELECT EXISTS (SELECT 1 FROM vaults.accounts WHERE tenant_id=$1 AND server_role='owner') AS owner_exists", [tenant.id]
      )).rows[0].owner_exists;
      writeJson(res, 200, { deployment: 'cloud', tenantId: tenant.id, canonicalUrl, ownerRequired: prepared && !ownerExists, activationPending: ownerExists });
      return true;
    }
    const context = Object.freeze({ tenant, origin: publicOrigin, canonicalUrl, pool: scopedPool,
      requirePrincipal: principal => requireTenantPrincipal(tenant, principal) });
    return (prepared && handleEnrollment ? handleEnrollment : handle)(req, res, context);
  };
}

export const createInternalCloudRequestBoundary = options => createBoundary({ ...options, enrollmentOnly: false });
export const createInternalCloudEnrollmentBoundary = options => createBoundary({ ...options, enrollmentOnly: true });
export const createInternalCloudRuntimeBoundary = options => createBoundary({ ...options, enrollmentOnly: false });

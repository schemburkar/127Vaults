import { writeError, writeJson } from './http-boundary.mjs';
import { loadLicenseStatus } from './license-status.mjs';

// Public only within the already constrained self-hosted HTTPS origin.
// No bootstrap capability, account identity, or license file is returned.
export function createSetupHandler({ pool, origin, licenseFile, publicKeyFile, revocationFile, smtpConfigured, clock }) {
  return async (req, res) => {
    if (new URL(req.url, origin).pathname !== '/api/v1/setup') return false;
    if (req.method !== 'GET') { writeError(res, 405, 'method_not_allowed'); return true; }
    try {
      const result = await pool.query(`SELECT i.id,
        EXISTS(SELECT 1 FROM vaults.accounts a WHERE a.tenant_id=i.id AND a.server_role='owner') AS owner_exists
        FROM vaults.installation i WHERE i.singleton=true`);
      if (result.rows.length !== 1) throw Error('installation_unavailable');
      const license = await loadLicenseStatus({ licenseFile, publicKeyFile, revocationFile, installationId: result.rows[0].id, clock });
      writeJson(res, 200, { ownerRequired: !result.rows[0].owner_exists,
        licenseMode: license.mode, licenseEnforcement: 'vault-access-writes-and-seats',
        licenseClockState: license.clockState ?? 'not_applicable', smtpConfigured: Boolean(smtpConfigured) });
    } catch { writeError(res, 503, 'setup_status_unavailable'); }
    return true;
  };
}

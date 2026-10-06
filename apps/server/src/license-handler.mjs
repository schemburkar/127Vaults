import { AuthError, AUTH_COOKIE } from './auth-policy.mjs';
import { writeError, writeJson } from './http-boundary.mjs';
import { loadLicenseStatus } from './license-status.mjs';

const cookie = req => {
  const value = String(req.headers.cookie ?? '').split(';').map(part => part.trim())
    .find(part => part.startsWith(`${AUTH_COOKIE}=`))?.slice(AUTH_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value ?? '') ? value : null;
};

export function createLicenseHandler({ pool, authenticate, origin, licenseFile, publicKeyFile }) {
  return async (req, res) => {
    if (new URL(req.url, origin).pathname !== '/api/v1/license') return false;
    if (req.method !== 'GET') { writeError(res, 405, 'method_not_allowed'); return true; }
    try {
      const token = cookie(req);
      if (!token) throw new AuthError();
      await authenticate(token);
      const result = await pool.query('SELECT id FROM vaults.installation');
      if (result.rows.length !== 1) throw new Error('installation_unavailable');
      const status = await loadLicenseStatus({ licenseFile, publicKeyFile, installationId: result.rows[0].id });
      writeJson(res, 200, { ...status, enforcement: 'disabled', scope: 'experimental' });
    } catch (error) {
      if (error instanceof AuthError) writeError(res, 401, 'authentication_required');
      else writeError(res, 503, 'license_status_unavailable');
    }
    return true;
  };
}

import { AuthError, AUTH_COOKIE } from './auth-policy.mjs';
import { writeError, writeJson } from './http-boundary.mjs';
import { loadLicenseStatus } from './license-status.mjs';
import { readSeatUsage } from './license-seats.mjs';

const cookie = req => {
  const value = String(req.headers.cookie ?? '').split(';').map(part => part.trim())
    .find(part => part.startsWith(`${AUTH_COOKIE}=`))?.slice(AUTH_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value ?? '') ? value : null;
};

export function createLicenseHandler({ pool, authenticate, origin, licenseFile, publicKeyFile, revocationFile, clock }) {
  return async (req, res) => {
    if (new URL(req.url, origin).pathname !== '/api/v1/license') return false;
    if (req.method !== 'GET') { writeError(res, 405, 'method_not_allowed'); return true; }
    try {
      const token = cookie(req);
      if (!token) throw new AuthError();
      await authenticate(token);
      const result = await pool.query('SELECT id FROM vaults.installation WHERE singleton=true');
      if (result.rows.length !== 1) throw new Error('installation_unavailable');
      const installationId = result.rows[0].id;
      const [status, usage] = await Promise.all([
        loadLicenseStatus({ licenseFile, publicKeyFile, revocationFile, installationId, clock }),
        readSeatUsage(pool, installationId, new Date())
      ]);
      writeJson(res, 200, { ...status, ...usage,
        seatsAvailable: status.maxActiveUsers === null ? null
          : Math.max(0, status.maxActiveUsers - usage.activeUsers - usage.reservedSeats),
        enforcement: status.mode === 'experimental' ? 'disabled' : 'vault-writes-and-seats', scope: 'experimental' });
    } catch (error) {
      if (error instanceof AuthError) writeError(res, 401, 'authentication_required');
      else writeError(res, 503, 'license_status_unavailable');
    }
    return true;
  };
}

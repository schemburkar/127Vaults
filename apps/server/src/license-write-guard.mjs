import { AUTH_COOKIE, AuthError } from './auth-policy.mjs';
import { writeError } from './http-boundary.mjs';
import { loadLicenseStatus } from './license-status.mjs';

const vaultPath = /^\/api\/v1\/vaults\/[0-9a-f-]+\/(?:items(?:\/[0-9a-f-]+)?|operations|checkpoint|removal)$/;
export function isLicensedWrite(method, path) {
  if (method === 'POST' && path === '/api/v1/vaults') return true;
  if (method === 'PUT' && path === '/api/v1/vault-settings') return true;
  if (method === 'POST' && path === '/api/v1/invitations') return true;
  if (!vaultPath.test(path)) return false;
  return method === 'POST' || method === 'PUT';
}

function sessionCookie(req) {
  const parts = String(req.headers.cookie ?? '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${AUTH_COOKIE}=`));
  const value = parts.length === 1 ? parts[0].slice(AUTH_COOKIE.length + 1) : '';
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function createLicenseWriteGuard({ pool, authenticate, origin, licenseFile, publicKeyFile, revocationFile, clock }) {
  return async (req, res) => {
    const path = new URL(req.url, origin).pathname;
    if (!isLicensedWrite(req.method, path)) return false;
    try {
      const token = sessionCookie(req);
      if (!token) throw new AuthError();
      await authenticate(token);
      const result = await pool.query('SELECT id FROM vaults.installation WHERE singleton=true');
      if (result.rows.length !== 1) throw Error('installation_unavailable');
      const status = await loadLicenseStatus({ licenseFile, publicKeyFile, revocationFile, installationId: result.rows[0].id, clock });
      if (status.mode === 'active' || status.mode === 'experimental') return false;
      writeError(res, 423, status.mode === 'revoked' ? 'license_revoked'
        : status.mode === 'locked' ? 'license_locked' : 'license_read_only');
    } catch (error) {
      writeError(res, error instanceof AuthError ? 401 : 503,
        error instanceof AuthError ? 'authentication_required' : 'license_status_unavailable');
    }
    return true;
  };
}

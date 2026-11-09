import { AUTH_COOKIE, AuthError, requireUnsafeRequest } from '../src/auth-policy.mjs';
import { HttpBoundaryError, parseJsonObject, readRequestBody, writeError, writeJson } from '../src/http-boundary.mjs';
import { readSeatUsage, requireLicenseSeats } from '../src/license-seats.mjs';
import { OnboardingError } from '../src/onboarding.mjs';
import { lockWritePrincipal } from '../src/write-principal.mjs';

const actions = new Set(['revoke-invitation', 'suspend-member', 'reactivate-member']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createCloudFamilyHandler({ pool, tenantId, origin, authenticate, loadEntitlement, invitationsEnabled }) {
  return async (req, res) => {
    const path = new URL(req.url, origin).pathname;
    const action = path.startsWith('/api/v1/cloud/family/') && path.slice('/api/v1/cloud/family/'.length);
    const entitlementRoute = path === '/api/v1/license';
    if (!entitlementRoute && path !== '/api/v1/cloud/family' && !actions.has(action)) return false;
    if (req.method !== (action ? 'POST' : 'GET')) { writeError(res, 405, 'method_not_allowed'); return true; }
    try {
      const cookie = (req.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${AUTH_COOKIE}=`));
      if (cookie.length !== 1) throw new AuthError();
      const auth = await authenticate(cookie[0].slice(AUTH_COOKIE.length + 1));
      let targetId;
      if (action) {
        requireUnsafeRequest(req, origin, req.headers['x-127v-csrf'], auth.csrf);
        ({ targetId } = parseJsonObject(req, await readRequestBody(req, 256), ['targetId']));
        if (typeof targetId !== 'string' || !uuid.test(targetId)) throw new HttpBoundaryError();
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (action) await client.query('SELECT pg_advisory_xact_lock(127,7)');
        const principal = await lockWritePrincipal(client, auth);
        if (!entitlementRoute && principal.server_role !== 'owner') throw new AuthError(403);
        const now = new Date();
        let result;
        if (action === 'revoke-invitation') {
          const updated = await client.query(`UPDATE vaults.invitation_records SET revoked_at=COALESCE(revoked_at,$3)
            WHERE tenant_id=$1 AND id=$2 RETURNING id`, [tenantId, targetId, now]);
          if (!updated.rowCount) throw new HttpBoundaryError(404, 'not_found');
          result = { revoked: true };
        } else if (action) {
          const member = (await client.query(`SELECT suspended_at FROM vaults.accounts
            WHERE tenant_id=$1 AND id=$2 AND server_role='user' AND enrollment_state='active' FOR UPDATE`, [tenantId, targetId])).rows[0];
          if (!member) throw new HttpBoundaryError(404, 'not_found');
          const suspend = action === 'suspend-member';
          if (suspend && !member.suspended_at) {
            await client.query('UPDATE vaults.accounts SET suspended_at=$3,session_epoch=session_epoch+1 WHERE tenant_id=$1 AND id=$2', [tenantId, targetId, now]);
            await client.query('UPDATE vaults.sessions SET revoked_at=$3 WHERE tenant_id=$1 AND account_id=$2 AND revoked_at IS NULL', [tenantId, targetId, now]);
          } else if (!suspend && member.suspended_at) {
            await requireLicenseSeats(client, tenantId, 1, now, loadEntitlement);
            await client.query('UPDATE vaults.accounts SET suspended_at=NULL WHERE tenant_id=$1 AND id=$2', [tenantId, targetId]);
          }
          result = { suspended: suspend };
        } else {
          const { maxActiveUsers } = await loadEntitlement(tenantId, now, client);
          const usage = await readSeatUsage(client, tenantId, now);
          const seats = { ...usage, maxActiveUsers, seatsAvailable: Math.max(0, maxActiveUsers - usage.activeUsers - usage.reservedSeats) };
          if (entitlementRoute) {
            const { expires_at: expiry } = (await client.query('SELECT expires_at FROM vaults.sessions WHERE tenant_id=$1 AND session_id=$2', [tenantId, auth.sessionId])).rows[0];
            result = { ...seats, scope: 'cloud-tenant', mode: 'active', role: principal.server_role, expiresAt: expiry, readOnlyUntil: expiry };
          } else {
            const members = (await client.query(`SELECT id,username,display_name AS "displayName",email,server_role AS role,
              suspended_at AS "suspendedAt" FROM vaults.accounts WHERE tenant_id=$1 AND enrollment_state='active' ORDER BY username_key`, [tenantId])).rows;
            const invitations = (await client.query(`SELECT i.id,i.expires_at AS "expiresAt",i.revoked_at AS "revokedAt",
              json_agg(json_build_object('email',e.email,'redeemedAt',e.redeemed_at) ORDER BY e.email) AS recipients
              FROM vaults.invitation_records i JOIN vaults.invitation_emails e USING (tenant_id,id)
              WHERE i.tenant_id=$1 AND i.expires_at>$2 GROUP BY i.tenant_id,i.id ORDER BY i.expires_at DESC`, [tenantId, now])).rows;
            result = { ...seats, invitationsEnabled, members, invitations };
          }
        }
        await client.query('COMMIT');
        writeJson(res, 200, result);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    } catch (error) {
      if (error instanceof AuthError) writeError(res, error.status, error.status === 403 ? 'forbidden' : 'authentication_required');
      else if (error instanceof HttpBoundaryError || error instanceof OnboardingError) writeError(res, error.status, error.code);
      else throw error;
    }
    return true;
  };
}

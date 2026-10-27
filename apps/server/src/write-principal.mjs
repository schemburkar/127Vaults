import { AuthError } from './auth-policy.mjs';

// Call inside the mutation transaction, before locking resource rows. These
// shared row locks make a write and a revocation serialize: once revocation
// commits, an earlier HTTP authentication result can no longer authorize data.
export async function lockWritePrincipal(client, auth) {
  const result = await client.query(`/* write_principal */
    SELECT a.server_role,c.credential_epoch,d.signing_public_key
    FROM vaults.accounts a
    JOIN vaults.authentication_credentials c ON(c.tenant_id=a.tenant_id AND c.account_id=a.id)
    JOIN vaults.devices d ON(d.tenant_id=a.tenant_id AND d.account_id=a.id AND d.id=$3)
    JOIN vaults.sessions s ON(s.tenant_id=a.tenant_id AND s.account_id=a.id AND s.device_id=d.id AND s.session_id=$4)
    WHERE a.tenant_id=$1 AND a.id=$2 AND a.enrollment_state='active' AND a.suspended_at IS NULL
      AND d.lifecycle_status='active' AND d.credential_epoch=c.credential_epoch
      AND c.credential_epoch=$5 AND s.credential_epoch=c.credential_epoch
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
      AND s.session_epoch=a.session_epoch AND s.device_auth_epoch=d.auth_epoch
    FOR SHARE OF a,c,d,s`,[auth.tenantId,auth.accountId,auth.deviceId,auth.sessionId,auth.credentialEpoch]);
  if (result.rows.length!==1) throw new AuthError(401);
  return result.rows[0];
}

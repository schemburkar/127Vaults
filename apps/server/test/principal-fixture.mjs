import { randomBytes, randomUUID } from 'node:crypto';

// Synthetic session rows for direct store tests; never usable bearer tokens.
export async function seedPrincipalSession(pool,auth) {
  auth.sessionId??=randomUUID();auth.credentialEpoch??=1;
  await pool.query(`INSERT INTO vaults.sessions(tenant_id,token_digest,account_id,device_id,credential_epoch,csrf_digest,csrf_cipher,session_id,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '1 hour')`,
    [auth.tenantId,randomBytes(32),auth.accountId,auth.deviceId,auth.credentialEpoch,randomBytes(32),Buffer.alloc(60),auth.sessionId]);
}

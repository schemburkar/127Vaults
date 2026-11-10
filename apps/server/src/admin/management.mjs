import { createHash, createHmac, randomUUID } from 'node:crypto';
import { normalizeEmail, tokenDigest } from '../onboarding.mjs';
import { requireLicenseSeats } from '../license-seats.mjs';
import { lockWritePrincipal } from '../write-principal.mjs';
import { AuthError } from '../auth-policy.mjs';

export class AdminManagementError extends Error {
  constructor(code = 'invalid_action', status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status = 409) => { throw new AdminManagementError(code, status); };
const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const specs = {
  'invitation.create': ['emails', 'expiresInHours'],
  'invitation.revoke': ['targetId'],
  'account.suspend': ['targetId'], 'account.reactivate': ['targetId'],
  'account.unlock': ['targetId'], 'role.set': ['targetId', 'role'],
  'device.revoke': ['targetId'], 'ownership.request': ['targetId'], 'ownership.cancel': ['targetId'],
};
const ownerOnly = new Set(['role.set', 'ownership.request', 'ownership.cancel']);
const hash = value => createHash('sha256').update(JSON.stringify(value, Object.keys(value).sort())).digest();

export function managementInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(specs, value.action) || !validId(value.requestId)) fail('invalid_action', 400);
  const fields = ['action', 'requestId', ...specs[value.action]];
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) fail('invalid_action', 400);
  if (value.targetId !== undefined && !validId(value.targetId)) fail('invalid_action', 400);
  if (value.action === 'role.set' && !['user', 'admin'].includes(value.role)) fail('ownership_acceptance_required', 400);
  if (value.action === 'invitation.create') {
    if (![24, 48].includes(value.expiresInHours) || !Array.isArray(value.emails) || value.emails.length < 1 || value.emails.length > 10) fail('invalid_action', 400);
    let emails;
    try { emails = value.emails.map(normalizeEmail); } catch { fail('invalid_action', 400); }
    if (new Set(emails).size !== emails.length) fail('invalid_action', 400);
    return { ...value, emails };
  }
  return { ...value };
}

export class PgAdminManagement {
  constructor(pool, { tokenKey, loadEntitlement = null } = {}) {
    if (!Buffer.isBuffer(tokenKey) || tokenKey.length !== 32) throw Error('Admin management requires the installation token key.');
    this.pool = pool; this.key = Buffer.from(tokenKey); this.loadEntitlement = loadEntitlement;
  }
  async transaction(action) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      // The same lock used by invitation creation and seat allocation.
      await client.query('SELECT pg_advisory_xact_lock(127,7)');
      const install = (await client.query('SELECT id FROM vaults.installation WHERE singleton=true FOR UPDATE')).rows[0];
      if (!install) fail('admin_unavailable', 503);
      const result = await action(client, install.id);
      await client.query('COMMIT'); return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof AdminManagementError || error instanceof AuthError) throw error;
      if (['LAST_ACTIVE_OWNER', 'OWNERSHIP_ACCEPTANCE_REQUIRED'].includes(error.message)) fail(error.message.toLowerCase());
      if (['seat_limit_reached', 'license_inactive', 'license_unavailable'].includes(error.code)) fail(error.code, error.status);
      fail('admin_unavailable', 503);
    } finally { client.release(); }
  }
  async audit(client, tenantId, actorId, action, targetId, outcome) {
    await client.query('INSERT INTO vaults.admin_control_audit(tenant_id,actor_id,action,target_id,outcome) VALUES($1,$2,$3,$4,$5)', [tenantId, actorId, action, targetId || null, outcome]);
  }
  async denied(actor, action, targetId) {
    // Audit separately after a failed transaction, without copying request bodies.
    await this.pool.query(`INSERT INTO vaults.admin_control_audit(tenant_id,actor_id,action,target_id,outcome)
      SELECT id,$1,$2,$3,'denied' FROM vaults.installation WHERE singleton=true`,
    [`operator:${actor.username}`, Object.hasOwn(specs, action) ? action : 'invalid_action', validId(targetId) ? targetId : null]);
  }
  async receipt(client, tenantId, actorId, input) {
    const row = (await client.query('SELECT actor_id,request_hash,result FROM vaults.admin_mutation_receipts WHERE tenant_id=$1 AND request_id=$2', [tenantId, input.requestId])).rows[0];
    if (!row) return null;
    if (row.actor_id !== actorId || !Buffer.from(row.request_hash).equals(hash(input))) fail('request_id_reused');
    return row.result;
  }
  async finish(client, tenantId, actorId, input, result) {
    await client.query('INSERT INTO vaults.admin_mutation_receipts(tenant_id,request_id,actor_id,request_hash,result) VALUES($1,$2,$3,$4,$5)', [tenantId, input.requestId, actorId, hash(input), result]);
    await this.audit(client, tenantId, actorId, input.action, input.targetId, 'accepted');
    return result;
  }
  invitationBytes(tenantId, requestId) {
    return createHmac('sha256', this.key).update('127Vaults/admin-invitation/1\0').update(tenantId).update('\0').update(requestId).digest();
  }
  async execute(actor, rawInput) {
    let input;
    try {
      input = managementInput(rawInput);
      if (!['owner', 'admin'].includes(actor.role) || ownerOnly.has(input.action) && actor.role !== 'owner') fail('forbidden', 403);
      return await this.transaction(async (client, tenantId) => {
        const actorId = `operator:${actor.username}`;
        const decorate = result => input.action === 'invitation.create' ? { ...result, token: `127V-I1-${this.invitationBytes(tenantId, input.requestId).toString('base64url')}` } : result;
        const receipt = await this.receipt(client, tenantId, actorId, input);
        if (receipt) return decorate(receipt);
        let result;
        if (input.action === 'invitation.create') {
          const owner = (await client.query("SELECT id FROM vaults.accounts WHERE tenant_id=$1 AND server_role='owner' AND enrollment_state='active' AND suspended_at IS NULL ORDER BY id LIMIT 1", [tenantId])).rows[0];
          if (!owner) fail('owner_required');
          if ((await client.query('SELECT 1 FROM vaults.accounts WHERE tenant_id=$1 AND email=ANY($2::text[])', [tenantId, input.emails])).rowCount) fail('email_already_registered');
          await requireLicenseSeats(client, tenantId, input.emails.length, new Date(), this.loadEntitlement);
          const invitationId = randomUUID(), bytes = this.invitationBytes(tenantId, input.requestId);
          const invitation = (await client.query(`INSERT INTO vaults.invitation_records(tenant_id,id,token_digest,created_by,expires_at)
            VALUES($1,$2,$3,$4,now()+($5*interval '1 hour')) RETURNING expires_at`, [tenantId, invitationId, tokenDigest(this.key, 'invite', bytes), owner.id, input.expiresInHours])).rows[0];
          for (const email of input.emails) await client.query('INSERT INTO vaults.invitation_emails(tenant_id,id,email) VALUES($1,$2,$3)', [tenantId, invitationId, email]);
          result = { invitationId, expiresAt: invitation.expires_at.toISOString(), seatCount: input.emails.length };
        } else if (input.action === 'invitation.revoke') {
          const row = await client.query('UPDATE vaults.invitation_records SET revoked_at=COALESCE(revoked_at,now()) WHERE tenant_id=$1 AND id=$2 RETURNING id', [tenantId, input.targetId]);
          if (!row.rowCount) fail('not_found', 404);
          result = { revoked: true };
        } else if (input.action === 'ownership.cancel') {
          const row = await client.query('UPDATE vaults.ownership_grants SET cancelled_at=COALESCE(cancelled_at,now()) WHERE tenant_id=$1 AND id=$2 AND accepted_at IS NULL RETURNING id', [tenantId, input.targetId]);
          if (!row.rowCount) fail('grant_unavailable');
          result = { cancelled: true };
        } else {
          const account = (await client.query(input.action === 'device.revoke'
            ? 'SELECT a.* FROM vaults.accounts a JOIN vaults.devices d ON d.tenant_id=a.tenant_id AND d.account_id=a.id WHERE a.tenant_id=$1 AND d.id=$2 FOR UPDATE OF a'
            : 'SELECT * FROM vaults.accounts WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, input.targetId])).rows[0];
          if (!account) fail('not_found', 404);
          if (account.server_role === 'owner' && actor.role !== 'owner') fail('forbidden', 403);
          if (input.action === 'account.suspend') {
            await client.query('UPDATE vaults.accounts SET suspended_at=COALESCE(suspended_at,now()),session_epoch=session_epoch+1 WHERE tenant_id=$1 AND id=$2', [tenantId, account.id]);
            await client.query('UPDATE vaults.sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE tenant_id=$1 AND account_id=$2', [tenantId, account.id]);
            result = { suspended: true };
          } else if (input.action === 'account.reactivate') {
            if (account.suspended_at) await requireLicenseSeats(client, tenantId, 1, new Date(), this.loadEntitlement);
            await client.query('UPDATE vaults.accounts SET suspended_at=NULL WHERE tenant_id=$1 AND id=$2', [tenantId, account.id]);
            result = { reactivated: true };
          } else if (input.action === 'account.unlock') {
            await client.query('UPDATE vaults.authentication_failures SET consecutive=0,delayed_until=NULL,admin_locked=false WHERE tenant_id=$1 AND account_id=$2', [tenantId, account.id]);
            result = { authenticationUnlocked: true };
          } else if (input.action === 'role.set') {
            await client.query('UPDATE vaults.accounts SET server_role=$3,session_epoch=session_epoch+1 WHERE tenant_id=$1 AND id=$2', [tenantId, account.id, input.role]);
            await client.query('UPDATE vaults.sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE tenant_id=$1 AND account_id=$2', [tenantId, account.id]);
            result = { role: input.role };
          } else if (input.action === 'device.revoke') {
            const row = await client.query("UPDATE vaults.devices SET lifecycle_status='revoked',auth_epoch=auth_epoch+1,revoked_at=now() WHERE tenant_id=$1 AND id=$2 AND lifecycle_status='active' RETURNING id", [tenantId, input.targetId]);
            if (!row.rowCount) fail('device_not_active');
            await client.query('UPDATE vaults.sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE tenant_id=$1 AND device_id=$2', [tenantId, input.targetId]);
            await client.query(`UPDATE vaults.accounts SET recovery_state=CASE WHEN EXISTS(
              SELECT 1 FROM vaults.devices WHERE tenant_id=$1 AND account_id=$2 AND lifecycle_status='active')
              THEN 'available' ELSE 'lost_last_device' END WHERE tenant_id=$1 AND id=$2`, [tenantId, account.id]);
            result = { revoked: true };
          } else if (input.action === 'ownership.request') {
            if (account.enrollment_state !== 'active' || account.suspended_at || account.server_role === 'owner') fail('recipient_unavailable');
            await client.query('UPDATE vaults.ownership_grants SET cancelled_at=now() WHERE tenant_id=$1 AND recipient_id=$2 AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at<=now()', [tenantId, account.id]);
            if ((await client.query('SELECT 1 FROM vaults.ownership_grants WHERE tenant_id=$1 AND recipient_id=$2 AND accepted_at IS NULL AND cancelled_at IS NULL', [tenantId, account.id])).rowCount) fail('grant_already_pending');
            const grant = (await client.query(`INSERT INTO vaults.ownership_grants(tenant_id,id,recipient_id,requested_by,expires_at)
              VALUES($1,$2,$3,$4,now()+interval '24 hours') RETURNING expires_at`, [tenantId, input.requestId, account.id, actorId])).rows[0];
            result = { grantId: input.requestId, expiresAt: grant.expires_at.toISOString(), acceptanceRequired: true };
          }
        }
        return decorate(await this.finish(client, tenantId, actorId, input, result));
      });
    } catch (error) {
      await this.denied(actor, input?.action || rawInput?.action, input?.targetId).catch(() => {});
      throw error;
    }
  }
  async grants(auth) {
    const rows = (await this.pool.query(`SELECT id,requested_by,expires_at FROM vaults.ownership_grants
      WHERE tenant_id=$1 AND recipient_id=$2 AND cancelled_at IS NULL AND accepted_at IS NULL AND expires_at>now() ORDER BY created_at`, [auth.tenantId, auth.accountId])).rows;
    return { grants: rows.map(row => ({ grantId: row.id, requestedBy: row.requested_by, expiresAt: row.expires_at.toISOString() })) };
  }
  async accept(auth, { grantId, requestId }) {
    if (!validId(grantId) || !validId(requestId)) fail('invalid_action', 400);
    const input = { action: 'ownership.accept', requestId, targetId: grantId };
    try { return await this.transaction(async (client, tenantId) => {
      if (tenantId !== auth.tenantId) fail('forbidden', 403);
      await lockWritePrincipal(client,auth);
      const active = (await client.query(`SELECT a.id FROM vaults.accounts a JOIN vaults.sessions s ON s.tenant_id=a.tenant_id AND s.account_id=a.id
        JOIN vaults.devices d ON d.tenant_id=s.tenant_id AND d.id=s.device_id
        WHERE a.tenant_id=$1 AND a.id=$2 AND a.enrollment_state='active' AND a.suspended_at IS NULL
        AND s.session_id=$3 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.created_at>now()-interval '5 minutes'
        AND d.lifecycle_status='active' FOR UPDATE OF a,s,d`, [tenantId, auth.accountId, auth.sessionId])).rows[0];
      if (!active) fail('fresh_auth_required', 403);
      const actorId = `account:${auth.accountId}`, receipt = await this.receipt(client, tenantId, actorId, input);
      if (receipt) return receipt;
      const grant = await client.query('UPDATE vaults.ownership_grants SET accepted_at=now() WHERE tenant_id=$1 AND id=$2 AND recipient_id=$3 AND cancelled_at IS NULL AND accepted_at IS NULL AND expires_at>now() RETURNING id', [tenantId, grantId, auth.accountId]);
      if (!grant.rowCount) fail('grant_unavailable');
      await client.query("UPDATE vaults.accounts SET server_role='owner',session_epoch=session_epoch+1 WHERE tenant_id=$1 AND id=$2", [tenantId, auth.accountId]);
      await client.query('UPDATE vaults.ownership_grants SET applied_at=now() WHERE tenant_id=$1 AND id=$2', [tenantId, grantId]);
      await client.query('UPDATE vaults.sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE tenant_id=$1 AND account_id=$2', [tenantId, auth.accountId]);
      return this.finish(client, tenantId, actorId, input, { accepted: true, role: 'owner', signInRequired: true });
    }); } catch (error) {
      await this.pool.query(`INSERT INTO vaults.admin_control_audit(tenant_id,actor_id,action,target_id,outcome)
        SELECT id,$2,'ownership.accept',$3,'denied' FROM vaults.installation WHERE id=$1`,
      [auth.tenantId, `account:${auth.accountId}`, grantId]).catch(() => {});
      throw error;
    }
  }
}

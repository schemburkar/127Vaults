import { randomUUID } from 'node:crypto';
import { OnboardingError } from './onboarding.mjs';
import { requireLicenseSeats } from './license-seats.mjs';
import { reserveSecurityRequest } from './security-limits.mjs';
import { lockWritePrincipal } from './write-principal.mjs';
import { AuthError } from './auth-policy.mjs';

export class PgOnboardingStore {
  constructor(pool, { tenantId = null, loadEntitlement = null } = {}) { this.pool = pool; this.tenantId = tenantId; this.loadEntitlement = loadEntitlement; }
  async authorizeRegistration(input) {
    const tenantId = this.tenantId ?? (await this.pool.query('SELECT id FROM vaults.installation WHERE singleton=true')).rows[0]?.id;
    if (!tenantId) throw new OnboardingError();
    if (!await reserveSecurityRequest(this.pool,{tenantId,purpose:'registration',source:input.source,now:input.now})) throw new OnboardingError('rate_limited',429);
    return this.#tx(async c => {
      // Neither bootstrap nor invitation registration may query an existing
      // account's OPRF. Credential updates have a separate authenticated path.
      if ((await c.query('SELECT 1 FROM vaults.accounts WHERE tenant_id=$1 AND id=$2',[tenantId,input.accountId])).rowCount) throw new OnboardingError();
      const allowed = input.bootstrap
        ? await c.query(`SELECT 1 FROM vaults.bootstrap_tokens b WHERE b.tenant_id=$1 AND b.token_digest=$2 AND b.consumed_at IS NULL AND b.expires_at>$3
            AND NOT EXISTS(SELECT 1 FROM vaults.accounts a WHERE a.tenant_id=b.tenant_id AND a.server_role='owner')`,[tenantId,input.digest,input.now])
        : await c.query(`SELECT 1 FROM vaults.invitation_records i JOIN vaults.invitation_emails e USING(tenant_id,id)
            WHERE i.tenant_id=$1 AND i.token_digest=$2 AND i.revoked_at IS NULL AND i.expires_at>$3 AND e.email=$4 AND e.redeemed_at IS NULL`,[tenantId,input.digest,input.now,input.email]);
      if (!allowed.rowCount) throw new OnboardingError();
      return { purpose:'enrollment' };
    });
  }
  async #tx(fn) { const c = await this.pool.connect(); try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e instanceof OnboardingError || e instanceof AuthError ? e : new OnboardingError(); } finally { c.release(); } }
  async bootstrapOwner(input) { return this.#tx(async c => {
    await c.query('SELECT pg_advisory_xact_lock(127,6)');
    const row=(await c.query(`SELECT b.tenant_id FROM vaults.bootstrap_tokens b WHERE b.token_digest=$1 AND b.consumed_at IS NULL AND b.expires_at>$2 FOR UPDATE`,[input.bootstrapDigest,input.now])).rows[0];
    if (!row || (await c.query("SELECT 1 FROM vaults.accounts WHERE tenant_id=$1 AND server_role='owner'",[row?.tenant_id])).rowCount) throw new OnboardingError();
    await requireLicenseSeats(c, row.tenant_id, 1, input.now, this.loadEntitlement);
    const x=input.candidate, accountId=x.accountId, key=s=>Buffer.from(s,'base64url');
    await c.query(`INSERT INTO vaults.accounts(tenant_id,id,username,display_name,email,server_role,enrollment_state,email_verified) VALUES($1,$2,$3,$4,$5,'owner','active',false)`,[row.tenant_id,accountId,x.username,x.displayName,x.email]);
    await c.query(`INSERT INTO vaults.authentication_credentials(tenant_id,account_id,opaque_record,wrapped_root_descriptor,wrapped_root_envelope) VALUES($1,$2,$3,$4,$5)`,[row.tenant_id,accountId,key(x.opaqueRecord),key(x.wrappedRootDescriptor),key(x.wrappedRootEnvelope)]);
    await c.query(`INSERT INTO vaults.devices(tenant_id,account_id,id,signing_public_key,credential_epoch,credential_epoch_seen) VALUES($1,$2,$3,$4,1,1)`,[row.tenant_id,accountId,x.deviceId,key(x.signingPublicKey)]);
    if(x.privateDirectory) { const d=key(x.privateDirectory); await c.query('INSERT INTO vaults.private_directories(tenant_id,account_id,revision,directory) VALUES($1,$2,$3,$4)',[row.tenant_id,accountId,`${d.subarray(36,40).toString('hex')}-${d.subarray(40,42).toString('hex')}-${d.subarray(42,44).toString('hex')}-${d.subarray(44,46).toString('hex')}-${d.subarray(46,52).toString('hex')}`,d]); }
    await c.query('UPDATE vaults.bootstrap_tokens SET consumed_at=$2 WHERE tenant_id=$1',[row.tenant_id,input.now]);
    return {accountId,deviceId:x.deviceId,emailVerified:false};
  }); }
  async createInvitation(input) { return this.#tx(async c => {
    await c.query('SELECT pg_advisory_xact_lock(127,7)');
    const principal=await lockWritePrincipal(c,input.auth);
    if(principal.server_role!=='owner'||input.auth.accountId!==input.ownerAccountId)throw new OnboardingError('forbidden',403);
    const owner=(await c.query(`SELECT tenant_id FROM vaults.accounts WHERE id=$1 AND server_role='owner' AND enrollment_state='active' FOR KEY SHARE`,[input.ownerAccountId])).rows[0];
    if (!owner) throw new OnboardingError('forbidden',403);
    const duplicate=await c.query('SELECT 1 FROM vaults.accounts WHERE tenant_id=$1 AND email=ANY($2::text[]) LIMIT 1',[owner.tenant_id,input.emails]);
    if (duplicate.rowCount) throw new OnboardingError();
    await requireLicenseSeats(c, owner.tenant_id, input.emails.length, input.now, this.loadEntitlement);
    await c.query(`INSERT INTO vaults.invitation_records(tenant_id,id,token_digest,created_by,expires_at) VALUES($1,$2,$3,$4,$5::timestamptz+($6*interval '1 hour'))`,[owner.tenant_id,input.invitationId,input.tokenDigest,input.ownerAccountId,input.now,input.expiresInHours]);
    for (const email of input.emails) await c.query('INSERT INTO vaults.invitation_emails(tenant_id,id,email) VALUES($1,$2,$3)',[owner.tenant_id,input.invitationId,email]);
    return {invitationId:input.invitationId,expiresAt:new Date(input.now.getTime()+input.expiresInHours*3_600_000).toISOString(),seatCount:input.emails.length};
  }); }
  async beginInvitation(input) {
    // Reserve before secret lookup so invalid tokens cannot bypass source/install limits by rolling back.
    const rate = this.tenantId
      ? await this.pool.query('SELECT vaults.reserve_onboarding_attempt($1,$2,$3,$4) AS ok', [this.tenantId, input.source, input.now, input.attemptId])
      : await this.pool.query('SELECT vaults.reserve_onboarding_attempt($1,$2,$3) AS ok', [input.source, input.now, input.attemptId]);
    if (!rate.rows[0].ok) throw new OnboardingError('rate_limited', 429);
    return this.#tx(async c => {
    const row = (await c.query(`SELECT i.tenant_id,i.id FROM vaults.invitation_records i JOIN vaults.invitation_emails e USING (tenant_id,id)
      WHERE i.token_digest=$1 AND e.email=$2 AND i.revoked_at IS NULL AND i.expires_at>$3 AND e.redeemed_at IS NULL FOR UPDATE OF i,e`, [input.inviteDigest, input.email, input.now])).rows[0];
    if (!row) throw new OnboardingError();
    // The service never persists the bearer capability, only its keyed digest.
    const capabilityDigest = input.capabilityDigest;
    await c.query(`INSERT INTO vaults.onboarding_attempts(tenant_id,id,invitation_id,email,capability_digest,candidate,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz + interval '10 minutes')`, [row.tenant_id,input.attemptId,row.id,input.email,capabilityDigest,input.candidate,input.now]);
    return { attemptId: input.attemptId };
    });
  }
  async stageEmail(input) { return this.#tx(async c => {
    const row = (await c.query(`SELECT tenant_id,email,email_generation,email_sent_at,email_send_count,email_window_started FROM vaults.onboarding_attempts
      WHERE id=$1 AND capability_digest=$2 AND expires_at>$3 AND committed_at IS NULL FOR UPDATE`, [input.attemptId,input.capabilityDigest,input.now])).rows[0];
    if (!row) throw new OnboardingError();
    if (row.email_sent_at && input.now - row.email_sent_at < 60_000) throw new OnboardingError('rate_limited',429);
    const reset = !row.email_window_started || input.now - row.email_window_started >= 3_600_000;
    if (!reset && row.email_send_count >= 5) throw new OnboardingError('rate_limited',429);
    const generation = Number(row.email_generation)+1;
    const codeDigest=input.codeDigestForGeneration(generation);
    await c.query(`UPDATE vaults.onboarding_attempts SET email_generation=$2,email_code_digest=$3,email_expires_at=$4::timestamptz+interval '10 minutes',email_failures=0,email_sent_at=$4,email_send_count=$5,email_window_started=$6 WHERE tenant_id=$1 AND id=$7`, [row.tenant_id,generation,codeDigest,input.now,reset?1:Number(row.email_send_count)+1,reset?input.now:row.email_window_started,input.attemptId]);
    return { email: row.email, generation };
  }); }
  async finalizeInvitation(input) {
    const result=await this.#tx(async c => {
    await c.query('SELECT pg_advisory_xact_lock(127,7)');
    const a=(await c.query(`SELECT * FROM vaults.onboarding_attempts WHERE id=$1 AND capability_digest=$2 FOR UPDATE`,[input.attemptId,input.capabilityDigest])).rows[0];
    if (!a) throw new OnboardingError();
    if (a.committed_at) return { accountId:a.account_id,deviceId:a.device_id };
    if (a.expires_at<=input.now || !a.email_code_digest || a.email_expires_at<=input.now || a.email_failures>=5) throw new OnboardingError();
    if (!a.email_code_digest.equals(input.codeDigestForGeneration(a.email_generation))) { await c.query('UPDATE vaults.onboarding_attempts SET email_failures=email_failures+1 WHERE tenant_id=$1 AND id=$2',[a.tenant_id,a.id]); return {failed:true}; }
    const seat=(await c.query(`SELECT e.redeemed_at,i.expires_at,i.revoked_at FROM vaults.invitation_emails e JOIN vaults.invitation_records i USING(tenant_id,id) WHERE e.tenant_id=$1 AND e.id=$2 AND e.email=$3 FOR UPDATE OF e,i`,[a.tenant_id,a.invitation_id,a.email])).rows[0];
    if (!seat || seat.redeemed_at || seat.revoked_at || seat.expires_at<=input.now) throw new OnboardingError();
    // Redeeming this reservation moves one seat from pending to active.
    await requireLicenseSeats(c, a.tenant_id, 0, input.now, this.loadEntitlement);
    const candidate=a.candidate, accountId=candidate.accountId, key=s=>Buffer.from(s,'base64url');
    await c.query(`INSERT INTO vaults.accounts(tenant_id,id,username,display_name,email,server_role,enrollment_state,email_verified) VALUES($1,$2,$3,$4,$5,'user','active',true)`,[a.tenant_id,accountId,candidate.username,candidate.displayName,a.email]);
    await c.query(`INSERT INTO vaults.authentication_credentials(tenant_id,account_id,opaque_record,wrapped_root_descriptor,wrapped_root_envelope) VALUES($1,$2,$3,$4,$5)`,[a.tenant_id,accountId,key(candidate.opaqueRecord),key(candidate.wrappedRootDescriptor),key(candidate.wrappedRootEnvelope)]);
    await c.query(`INSERT INTO vaults.devices(tenant_id,account_id,id,signing_public_key,credential_epoch,credential_epoch_seen) VALUES($1,$2,$3,$4,1,1)`,[a.tenant_id,accountId,candidate.deviceId,key(candidate.signingPublicKey)]);
    if(candidate.privateDirectory) { const d=key(candidate.privateDirectory); await c.query('INSERT INTO vaults.private_directories(tenant_id,account_id,revision,directory) VALUES($1,$2,$3,$4)',[a.tenant_id,accountId,`${d.subarray(36,40).toString('hex')}-${d.subarray(40,42).toString('hex')}-${d.subarray(42,44).toString('hex')}-${d.subarray(44,46).toString('hex')}-${d.subarray(46,52).toString('hex')}`,d]); }
    await c.query(`UPDATE vaults.invitation_emails SET redeemed_at=$4,account_id=$5 WHERE tenant_id=$1 AND id=$2 AND email=$3`,[a.tenant_id,a.invitation_id,a.email,input.now,accountId]);
    await c.query(`UPDATE vaults.onboarding_attempts SET committed_at=$3,account_id=$4,device_id=$5,email_code_digest=NULL WHERE tenant_id=$1 AND id=$2`,[a.tenant_id,a.id,input.now,accountId,candidate.deviceId]);
    return {accountId,deviceId:candidate.deviceId};
    });
    if(result.failed) throw new OnboardingError();
    return result;
  }
}

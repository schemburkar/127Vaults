import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { reserveSecurityRequest } from './security-limits.mjs';
import { AuthError } from './auth-policy.mjs';
import { lockWritePrincipal } from './write-principal.mjs';

export class DeviceLifecycleStoreError extends Error {
  constructor(code = 'INVALID_REQUEST', status = 400) { super(code); this.code = code; this.status = status; }
}
const fail=(code='INVALID_REQUEST',status=400)=>{throw new DeviceLifecycleStoreError(code,status)};
const b64=v=>Buffer.from(v).toString('base64url');
const digest=v=>createHash('sha256').update(v).digest();
const der=raw=>createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(raw)]),format:'der',type:'spki'});
const canon=v=>JSON.stringify(v,Object.keys(v).sort());
const uuid=v=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v??''))fail();return v.toLowerCase()};
const rawKey=v=>{let x;try{x=Buffer.from(v,'base64url')}catch{fail()}if(x.length!==32)fail();return x};
const sig=v=>{let x;try{x=Buffer.from(v,'base64url')}catch{fail()}if(x.length!==64)fail();return x};
const username=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_][A-Za-z0-9_.-]{4,63}$/.test(v))fail();return v.toLowerCase()};
const codeValue=v=>{const x=String(v??'').toUpperCase();if(!/^[A-HJ-NP-Z2-9]{8}$/.test(x))fail('ENROLLMENT_INVALID',409);return x};
const enrollmentRequest=v=>({deviceId:v.deviceId,publicKey:v.publicKey,purpose:'enrollment-request',username:v.username});

export class PgDeviceLifecycleStore {
  constructor(pool,{now=()=>new Date(),random=size=>randomBytes(size),tenantId=null}={}){this.pool=pool;this.now=now;this.random=random;this.tenantId=tenantId}
  async #tx(fn){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5s'");await c.query("SET LOCAL lock_timeout='5s'");const out=await fn(c);await c.query('COMMIT');return out}catch(e){await c.query('ROLLBACK').catch(()=>{});if(!(e instanceof DeviceLifecycleStoreError)&&!(e instanceof AuthError))console.error('Device lifecycle transaction failed.',e?.code??'DATABASE_ERROR');throw e instanceof DeviceLifecycleStoreError||e instanceof AuthError?e:new DeviceLifecycleStoreError('UNAVAILABLE',503)}finally{c.release()}}
  async #account(c,auth){const r=(await c.query('SELECT c.credential_epoch,a.session_epoch,a.recovery_state FROM vaults.accounts a JOIN vaults.authentication_credentials c ON(c.tenant_id=a.tenant_id AND c.account_id=a.id) WHERE a.tenant_id=$1 AND a.id=$2 FOR UPDATE OF a,c',[auth.tenantId,auth.accountId])).rows[0];if(!r)fail('NOT_FOUND',404);return r}
  async #active(c,auth,id=auth.deviceId){await lockWritePrincipal(c,auth);const r=(await c.query("SELECT signing_public_key,auth_epoch FROM vaults.devices WHERE tenant_id=$1 AND account_id=$2 AND id=$3 AND lifecycle_status='active' FOR UPDATE",[auth.tenantId,auth.accountId,id])).rows[0];if(!r)fail('AUTH_REQUIRED',401);return r}
  #audit(c,auth,action,{subject=null,enrollment=null,recovery=null,detail='' }={}){return c.query('INSERT INTO vaults.device_lifecycle_audit(tenant_id,account_id,actor_device_id,subject_device_id,enrollment_id,recovery_id,action,outcome,detail_hash) VALUES($1,$2,$3,$4,$5,$6,$7,\'accepted\',$8)',[auth.tenantId,auth.accountId,auth.deviceId,subject,enrollment,recovery,action,digest(detail)])}
  async requestEnrollment({username:rawUsername,newDeviceId,newDevicePublicKey,requestSignature,source='unknown'}){const usernameKey=username(rawUsername),deviceId=uuid(newDeviceId),key=rawKey(newDevicePublicKey),signature=sig(requestSignature),request=enrollmentRequest({username:rawUsername,deviceId,publicKey:b64(key)});if(!verify(null,Buffer.from(canon(request)),der(key),signature))fail();const tenantId=this.tenantId??(await this.pool.query('SELECT id FROM vaults.installation WHERE singleton=true')).rows[0]?.id;if(!tenantId)fail('UNAVAILABLE',503);if(!await reserveSecurityRequest(this.pool,{tenantId,purpose:'enrollment',source,now:this.now()}))fail('RATE_LIMITED',429);return this.#tx(async c=>{await c.query("DELETE FROM vaults.device_enrollment_requests WHERE tenant_id=$1 AND consumed_at IS NULL AND expires_at<now()-interval '1 hour'",[tenantId]);const account=(await c.query("SELECT tenant_id,id FROM vaults.accounts WHERE username_key=$1 AND tenant_id=$2 AND enrollment_state='active' AND suspended_at IS NULL",[usernameKey,tenantId])).rows[0];const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',random=this.random(8),code=[...random].map(x=>alphabet[x%alphabet.length]).join(''),pollToken=b64(this.random(32)),id=randomUUID(),now=this.now(),expiresAt=new Date(now.getTime()+10*60*1000);if(!account)return{enrollmentId:id,code,pollToken,expiresAt:expiresAt.toISOString()};await c.query('INSERT INTO vaults.device_enrollment_requests(tenant_id,account_id,id,username_key,code_digest,poll_token_digest,proposed_device_id,proposed_signing_public_key,request_signature,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING',[account.tenant_id,account.id,id,usernameKey,digest(code),digest(pollToken),deviceId,key,signature,now,expiresAt]);return{enrollmentId:id,code,pollToken,expiresAt:expiresAt.toISOString()}})}
  async inspectEnrollment(auth,{code}){code=codeValue(code);return this.#tx(async c=>{await this.#active(c,auth);const e=(await c.query('SELECT * FROM vaults.device_enrollment_requests WHERE tenant_id=$1 AND account_id=$2 AND code_digest=$3 FOR UPDATE',[auth.tenantId,auth.accountId,digest(code)])).rows[0];if(!e||e.consumed_at||e.expires_at<=this.now())fail('ENROLLMENT_INVALID',409);return{accountId:auth.accountId,enrollmentId:e.id,newDeviceId:e.proposed_device_id,newDevicePublicKey:b64(e.proposed_signing_public_key),expiresAt:e.expires_at.toISOString()}})}
  async approveEnrollmentRequest(auth,{enrollmentId,approvalSignature}){enrollmentId=uuid(enrollmentId);const signature=sig(approvalSignature);return this.#tx(async c=>{const actor=await this.#active(c,auth),e=(await c.query('SELECT * FROM vaults.device_enrollment_requests WHERE tenant_id=$1 AND account_id=$2 AND id=$3 FOR UPDATE',[auth.tenantId,auth.accountId,enrollmentId])).rows[0];if(!e||e.approved_at||e.consumed_at||e.expires_at<=this.now())fail('ENROLLMENT_INVALID',409);const binding={accountId:auth.accountId,enrollmentId,newDeviceId:e.proposed_device_id,newDevicePublicKey:b64(e.proposed_signing_public_key),expiresAt:e.expires_at.toISOString()};if(!verify(null,Buffer.from(canon(binding)),der(actor.signing_public_key),signature))fail('ENROLLMENT_INVALID',409);await c.query('UPDATE vaults.device_enrollment_requests SET approver_device_id=$4,approval_signature=$5,approved_at=$6 WHERE tenant_id=$1 AND account_id=$2 AND id=$3',[auth.tenantId,auth.accountId,enrollmentId,auth.deviceId,signature,this.now()]);return{approved:true}})}
  async pollEnrollment({enrollmentId,pollToken}){enrollmentId=uuid(enrollmentId);if(typeof pollToken!=='string'||pollToken.length!==43)fail();const e=(await this.pool.query('SELECT r.*,d.signing_public_key approver_public_key FROM vaults.device_enrollment_requests r LEFT JOIN vaults.devices d ON(d.tenant_id=r.tenant_id AND d.id=r.approver_device_id) WHERE r.id=$1 AND r.poll_token_digest=$2',[enrollmentId,digest(pollToken)])).rows[0];if(!e||(!e.consumed_at&&e.expires_at<=this.now()))return{status:'pending'};if(!e.approved_at)return{status:'pending'};return{status:'approved',binding:{accountId:e.account_id,enrollmentId:e.id,newDeviceId:e.proposed_device_id,newDevicePublicKey:b64(e.proposed_signing_public_key),expiresAt:e.expires_at.toISOString()},approvalSignature:b64(e.approval_signature),approverPublicKey:b64(e.approver_public_key)}}
  async completeEnrollmentRequest({ enrollmentId, pollToken, possessionSignature }) {
    enrollmentId = uuid(enrollmentId);
    if (typeof pollToken !== 'string' || pollToken.length !== 43) fail();
    const possession = sig(possessionSignature);
    return this.#tx(async client => {
      const e = (await client.query('SELECT * FROM vaults.device_enrollment_requests WHERE id=$1 AND poll_token_digest=$2 FOR UPDATE', [enrollmentId, digest(pollToken)])).rows[0];
      if (!e || !e.approved_at || (!e.consumed_at && e.expires_at <= this.now())) fail('ENROLLMENT_INVALID', 409);
      const binding = { accountId: e.account_id, enrollmentId, newDeviceId: e.proposed_device_id, newDevicePublicKey: b64(e.proposed_signing_public_key), expiresAt: e.expires_at.toISOString() };
      if (!verify(null, Buffer.from(canon({ ...binding, purpose: 'device-possession' })), der(e.proposed_signing_public_key), possession)) fail('ENROLLMENT_INVALID', 409);
      if (e.consumed_at) {
        // A browser may lose the success response or crash before committing
        // its identity. Replaying the same possession proof must not strand it.
        const registered = (await client.query('SELECT lifecycle_status,signing_public_key,credential_epoch_seen FROM vaults.devices WHERE tenant_id=$1 AND account_id=$2 AND id=$3', [e.tenant_id, e.account_id, e.proposed_device_id])).rows[0];
        if (!registered || registered.lifecycle_status !== 'active' || !Buffer.from(registered.signing_public_key).equals(Buffer.from(e.proposed_signing_public_key))) fail('ENROLLMENT_INVALID', 409);
        return { version: 1, deviceId: e.proposed_device_id, credentialEpoch: Number(registered.credential_epoch_seen) };
      }
      // Approval is a delegated device authority, so an unconsumed request must
      // not outlive revocation or account/device credential replacement. Lock
      // these rows through insertion so revocation cannot pass this check.
      const credential = (await client.query(`SELECT c.credential_epoch FROM vaults.devices d
        JOIN vaults.accounts a ON(a.tenant_id=d.tenant_id AND a.id=d.account_id)
        JOIN vaults.authentication_credentials c ON(c.tenant_id=a.tenant_id AND c.account_id=a.id)
        WHERE d.tenant_id=$1 AND d.account_id=$2 AND d.id=$3
          AND d.lifecycle_status='active' AND d.credential_epoch=c.credential_epoch
          AND a.enrollment_state='active' AND a.suspended_at IS NULL
        FOR UPDATE OF d,a,c`, [e.tenant_id, e.account_id, e.approver_device_id])).rows[0];
      if (!credential) fail('ENROLLMENT_INVALID', 409);
      await client.query("INSERT INTO vaults.devices(tenant_id,id,account_id,signing_public_key,credential_epoch,lifecycle_status,auth_epoch,credential_epoch_seen,credential_state,protection_class) VALUES($1,$2,$3,$4,$5,'active',1,$5,'current','unknown')", [e.tenant_id, e.proposed_device_id, e.account_id, e.proposed_signing_public_key, Number(credential.credential_epoch)]);
      await client.query('UPDATE vaults.device_enrollment_requests SET consumed_at=$3 WHERE tenant_id=$1 AND id=$2', [e.tenant_id, e.id, this.now()]);
      return { version: 1, deviceId: e.proposed_device_id, credentialEpoch: Number(credential.credential_epoch) };
    });
  }
  async list(auth){const rows=(await this.pool.query('SELECT id,lifecycle_status,auth_epoch,credential_epoch_seen,credential_state,protection_class,protection_verified_at,revoked_at FROM vaults.devices WHERE tenant_id=$1 AND account_id=$2 ORDER BY id',[auth.tenantId,auth.accountId])).rows;return {devices:rows.map(r=>({deviceId:r.id,status:r.lifecycle_status,authEpoch:Number(r.auth_epoch),credentialEpochSeen:Number(r.credential_epoch_seen),credentialState:r.credential_state,protectionClass:r.protection_class,protectionVerifiedAt:r.protection_verified_at?.toISOString?.()??null,revokedAt:r.revoked_at?.toISOString?.()??null}))}}
  async beginEnrollment(auth,{newDeviceId,newDevicePublicKey,protectionClass='unknown',protectionVerified=false}){newDeviceId=uuid(newDeviceId);const key=rawKey(newDevicePublicKey);if(!['unknown','software','platform','hardware'].includes(protectionClass)||typeof protectionVerified!=='boolean'||!auth.sessionId)fail('AUTH_REQUIRED',401);return this.#tx(async c=>{await this.#active(c,auth);const a=await this.#account(c,auth);const exists=(await c.query('SELECT 1 FROM vaults.devices WHERE tenant_id=$1 AND id=$2',[auth.tenantId,newDeviceId])).rowCount;if(exists)fail('CONFLICT',409);const enrollmentId=randomUUID(),code=b64(this.random(16)),now=this.now(),expiresAt=new Date(now.getTime()+300000);await c.query(`INSERT INTO vaults.device_enrollments(tenant_id,account_id,id,approver_session_id,proposed_device_id,proposed_signing_public_key,protection_class,protection_verified,credential_epoch_snapshot,code_digest,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[auth.tenantId,auth.accountId,enrollmentId,auth.sessionId,newDeviceId,key,protectionClass,protectionVerified,Number(a.credential_epoch),digest(code),now,expiresAt]);await this.#audit(c,auth,'enrollment.begin',{enrollment:enrollmentId,detail:newDeviceId});return {enrollmentId,code,expiresAt:expiresAt.toISOString(),newDeviceId,newDevicePublicKey:b64(key)}})}
  async approveEnrollment(auth,{enrollmentId,code,approvalSignature,possessionSignature}){enrollmentId=uuid(enrollmentId);if(typeof code!=='string'||code.length>64)fail();return this.#tx(async c=>{const actor=await this.#active(c,auth),now=this.now();const e=(await c.query('SELECT * FROM vaults.device_enrollments WHERE tenant_id=$1 AND account_id=$2 AND id=$3 FOR UPDATE',[auth.tenantId,auth.accountId,enrollmentId])).rows[0];if(!e||e.consumed_at||e.cancelled_at||e.expires_at<=now||!digest(code).equals(Buffer.from(e.code_digest)))fail('ENROLLMENT_INVALID',409);const a=await this.#account(c,auth);if(Number(a.credential_epoch)!==Number(e.credential_epoch_snapshot)||e.approver_session_id!==auth.sessionId)fail('ENROLLMENT_INVALID',409);const binding={accountId:auth.accountId,enrollmentId,newDeviceId:e.proposed_device_id,newDevicePublicKey:b64(e.proposed_signing_public_key),expiresAt:e.expires_at.toISOString()};if(!verify(null,Buffer.from(canon(binding)),der(actor.signing_public_key),sig(approvalSignature))||!verify(null,Buffer.from(canon({...binding,purpose:'device-possession'})),der(e.proposed_signing_public_key),sig(possessionSignature)))fail('ENROLLMENT_INVALID',409);await c.query(`INSERT INTO vaults.devices(tenant_id,id,account_id,signing_public_key,credential_epoch,lifecycle_status,auth_epoch,credential_epoch_seen,credential_state,protection_class,protection_verified_at) VALUES($1,$2,$3,$4,$5,'active',1,$5,'current',$6,$7)`,[auth.tenantId,e.proposed_device_id,auth.accountId,e.proposed_signing_public_key,Number(a.credential_epoch),e.protection_class,e.protection_verified?now:null]);await c.query('UPDATE vaults.device_enrollments SET consumed_at=$4,approval_signature=$5,possession_signature=$6 WHERE tenant_id=$1 AND account_id=$2 AND id=$3',[auth.tenantId,auth.accountId,enrollmentId,now,sig(approvalSignature),sig(possessionSignature)]);return {deviceId:e.proposed_device_id,credentialEpoch:Number(a.credential_epoch)}})}
  async revoke(auth, { deviceId }) {
    deviceId = uuid(deviceId);
    return this.#tx(async c => {
      await this.#active(c, auth);
      await this.#active(c, auth, deviceId);
      const now = this.now();
      await c.query("UPDATE vaults.devices SET lifecycle_status='revoked',auth_epoch=auth_epoch+1,revoked_at=$4 WHERE tenant_id=$1 AND account_id=$2 AND id=$3",
        [auth.tenantId, auth.accountId, deviceId, now]);
      await c.query('UPDATE vaults.sessions SET revoked_at=$4 WHERE tenant_id=$1 AND account_id=$2 AND device_id=$3 AND revoked_at IS NULL',
        [auth.tenantId, auth.accountId, deviceId, now]);
      const active = (await c.query("SELECT 1 FROM vaults.devices WHERE tenant_id=$1 AND account_id=$2 AND lifecycle_status='active' LIMIT 1",
        [auth.tenantId, auth.accountId])).rowCount;
      // A non-self revocation leaves recovery available. Do not fire the frozen
      // ownership-protection trigger for an account value that did not change.
      await c.query('UPDATE vaults.accounts SET recovery_state=$3 WHERE tenant_id=$1 AND id=$2 AND recovery_state IS DISTINCT FROM $3',
        [auth.tenantId, auth.accountId, active ? 'available' : 'lost_last_device']);
      await this.#audit(c, auth, 'device.revoke', { subject: deviceId });
      return { deviceId, status: 'revoked', lostLastDevice: !active };
    });
  }
}

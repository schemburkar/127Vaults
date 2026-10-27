import { createHash, createPublicKey, verify } from 'node:crypto';
import { AUTH_COOKIE, AuthError, decodeField, requireUnsafeRequest } from './auth-policy.mjs';
import { HttpBoundaryError, parseJsonObject, readRequestBody, writeError, writeJson } from './http-boundary.mjs';
import { createRegistrationCompletion } from './opaque-adapter.mjs';
import { canonicalBytes } from '../../../packages/sync/src/index.mjs';
import { validateSettingsEnvelope } from './vault-settings-handler.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const binary = (value,max) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new AuthError(400);
  const bytes=Buffer.from(value,'base64url');
  if (bytes.length>max || bytes.toString('base64url')!==value) throw new AuthError(400);
  return bytes;
};

// The current device authorizes the entire replacement, independently of the
// new device's activation/possession proof. This is not a bearer-session reset.
export function credentialRotationBytes({ auth, kind, epoch, candidate, artifact, settings=null }) {
  return Buffer.concat([Buffer.from('127Vaults/credential-rotation/1\0'),canonicalBytes({
    kind,tenantId:auth.tenantId,accountId:auth.accountId,deviceId:auth.deviceId,
    sessionId:auth.sessionId,credentialEpoch:epoch,newDeviceId:candidate.deviceId,
    signingPublicKey:candidate.signingPublicKey,opaqueRecord:sha(Buffer.from(candidate.opaqueRecord,'base64url')),
    descriptor:sha(Buffer.from(candidate.wrappedRootDescriptor,'base64url')),
    envelope:sha(Buffer.from(candidate.wrappedRootEnvelope,'base64url')),attempt:artifact.attempt,
    settings:settings===null?null:{baseRevision:settings.baseRevision,revision:settings.revision,envelope:sha(binary(settings.envelope,16557))}
  })]);
}

function validateRoot(candidate,auth,epoch) {
  const descriptor=binary(candidate.wrappedRootDescriptor,4096),envelope=binary(candidate.wrappedRootEnvelope,16384);
  const id = value => Buffer.from(value.replaceAll('-',''),'hex');
  if (descriptor.length!==93 || descriptor[0]!==1 || !descriptor.subarray(1,17).equals(id(auth.tenantId))
      || !descriptor.subarray(17,33).equals(id(auth.accountId)) || !descriptor.subarray(33,65).every(x=>x===0)
      || descriptor.readUInt32BE(81)!==1 || descriptor.readBigUInt64BE(85)!==BigInt(epoch)
      || envelope.length!==205 || envelope.subarray(0,8).toString('binary')!=='127VEXP\0'
      || envelope.readUInt16BE(8)!==1 || envelope[10]!==1 || envelope[11]!==1
      || !envelope.subarray(12,104).equals(descriptor.subarray(1))
      || envelope.readUInt32BE(120)!==65536 || envelope.readUInt32BE(124)!==3 || envelope[128]!==1
      || envelope.readUInt32BE(153)!==envelope.length-157) throw new AuthError(400);
}

export class PgCredentialRotationStore {
  constructor(pool) { this.pool=pool; }
  async transaction(action) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='5s'");
      const result=await action(client);await client.query('COMMIT');return result;
    } catch(error) { await client.query('ROLLBACK').catch(()=>{});throw error; }
    finally { client.release(); }
  }
  async context(client,auth) {
    const row=(await client.query(`SELECT c.credential_epoch,d.signing_public_key FROM vaults.accounts a
      JOIN vaults.authentication_credentials c ON(c.tenant_id=a.tenant_id AND c.account_id=a.id)
      JOIN vaults.devices d ON(d.tenant_id=a.tenant_id AND d.account_id=a.id AND d.id=$3)
      JOIN vaults.sessions s ON(s.tenant_id=a.tenant_id AND s.account_id=a.id AND s.device_id=d.id AND s.session_id=$4)
      WHERE a.tenant_id=$1 AND a.id=$2 AND a.enrollment_state='active' AND a.suspended_at IS NULL
        AND d.lifecycle_status='active' AND d.credential_epoch=c.credential_epoch
        AND s.revoked_at IS NULL AND s.expires_at>now() AND s.created_at>now()-interval '5 minutes'
        AND s.credential_epoch=c.credential_epoch AND s.session_epoch=a.session_epoch AND s.device_auth_epoch=d.auth_epoch
      FOR UPDATE OF a,c,d,s`,[auth.tenantId,auth.accountId,auth.deviceId,auth.sessionId])).rows[0];
    if (!row || Number(row.credential_epoch)!==auth.credentialEpoch) throw new AuthError(403);
    return row;
  }
  prepare(auth) { return this.transaction(async client => {
    const row=await this.context(client,auth),epoch=Number(row.credential_epoch)+1;
    if (!Number.isSafeInteger(epoch)) throw new AuthError(400);
    return epoch;
  }); }
  commit(auth,{kind,candidate,artifact,authorizationSignature,settings=null}) {
    return this.transaction(async client => {
      const row=await this.context(client,auth),epoch=Number(row.credential_epoch)+1;
      if (!['password','account-secret'].includes(kind) || artifact.purpose!==(kind==='password'?'password-rotation':'secret-rotation')
          || artifact.expires<=Date.now() || artifact.installation!==auth.tenantId || artifact.accountId!==auth.accountId || artifact.deviceId!==candidate.deviceId
          || artifact.credentialEpoch!==epoch || artifact.sessionId!==auth.sessionId || artifact.approverDeviceId!==auth.deviceId
          || candidate.accountId!==auth.accountId || !uuid(candidate.deviceId)) throw new AuthError(403);
      const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),row.signing_public_key]),format:'der',type:'spki'});
      if (!verify(null,credentialRotationBytes({auth,kind,epoch,candidate,artifact,settings}),publicKey,decodeField(authorizationSignature,64))) throw new AuthError(403);
      validateRoot(candidate,auth,epoch);
      if (kind==='password' && (candidate.deviceId!==auth.deviceId || !decodeField(candidate.signingPublicKey,32).equals(row.signing_public_key))) throw new AuthError(403);
      if (kind==='account-secret' && candidate.deviceId===auth.deviceId) throw new AuthError(400);
      const previousSettings=(await client.query('SELECT revision FROM vaults.private_account_settings WHERE tenant_id=$1 AND account_id=$2 FOR UPDATE',[auth.tenantId,auth.accountId])).rows[0];
      if (settings===null) {
        if(previousSettings)throw new AuthError(400);
      } else {
        if (!settings || Object.keys(settings).sort().join(',')!=='baseRevision,envelope,revision'
            || !uuid(settings.revision) || settings.revision===settings.baseRevision
            || (settings.baseRevision!==null&&!uuid(settings.baseRevision))
            || (previousSettings?.revision??null)!==settings.baseRevision) throw new AuthError(400);
        const envelope=binary(settings.envelope,16557);
        validateSettingsEnvelope(envelope,{...auth,credentialEpoch:epoch},settings.revision);
        await client.query(`INSERT INTO vaults.private_account_settings(tenant_id,account_id,revision,envelope) VALUES($1,$2,$3,$4)
          ON CONFLICT(tenant_id,account_id) DO UPDATE SET revision=EXCLUDED.revision,envelope=EXCLUDED.envelope,updated_at=now()`,[auth.tenantId,auth.accountId,settings.revision,envelope]);
      }
      await client.query('UPDATE vaults.authentication_credentials SET credential_epoch=$3,opaque_record=$4,wrapped_root_descriptor=$5,wrapped_root_envelope=$6 WHERE tenant_id=$1 AND account_id=$2',
        [auth.tenantId,auth.accountId,epoch,decodeField(candidate.opaqueRecord,192),binary(candidate.wrappedRootDescriptor,4096),binary(candidate.wrappedRootEnvelope,16384)]);
      await client.query("UPDATE vaults.accounts SET session_epoch=session_epoch+1,recovery_state='available' WHERE tenant_id=$1 AND id=$2",[auth.tenantId,auth.accountId]);
      if (kind==='password') {
        await client.query("UPDATE vaults.devices SET credential_epoch=$3,credential_epoch_seen=CASE WHEN id=$4 THEN $3 ELSE credential_epoch_seen END,credential_state=CASE WHEN id=$4 THEN 'current' ELSE 'rotation_required' END WHERE tenant_id=$1 AND account_id=$2 AND lifecycle_status='active'",[auth.tenantId,auth.accountId,epoch,auth.deviceId]);
      } else {
        await client.query("UPDATE vaults.devices SET lifecycle_status='replaced',auth_epoch=auth_epoch+1,credential_state='stale',revoked_at=now() WHERE tenant_id=$1 AND account_id=$2 AND lifecycle_status='active'",[auth.tenantId,auth.accountId]);
        await client.query("INSERT INTO vaults.devices(tenant_id,account_id,id,signing_public_key,credential_epoch,credential_epoch_seen,lifecycle_status,protection_class) VALUES($1,$2,$3,$4,$5,$5,'active','unknown')",[auth.tenantId,auth.accountId,candidate.deviceId,decodeField(candidate.signingPublicKey,32),epoch]);
      }
      await client.query('UPDATE vaults.sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE tenant_id=$1 AND account_id=$2',[auth.tenantId,auth.accountId]);
      await client.query('DELETE FROM vaults.authentication_capabilities WHERE tenant_id=$1 AND account_id=$2',[auth.tenantId,auth.accountId]);
      await client.query('DELETE FROM vaults.authentication_attempts WHERE tenant_id=$1 AND account_id=$2',[auth.tenantId,auth.accountId]);
      await client.query('UPDATE vaults.device_enrollments SET cancelled_at=now() WHERE tenant_id=$1 AND account_id=$2 AND consumed_at IS NULL',[auth.tenantId,auth.accountId]);
      await client.query('DELETE FROM vaults.device_enrollment_requests WHERE tenant_id=$1 AND account_id=$2 AND consumed_at IS NULL',[auth.tenantId,auth.accountId]);
      await client.query("INSERT INTO vaults.authentication_failures(tenant_id,account_id,consecutive) VALUES($1,$2,0) ON CONFLICT(tenant_id,account_id) DO UPDATE SET consecutive=0,delayed_until=NULL,admin_locked=false",[auth.tenantId,auth.accountId]);
      await client.query("INSERT INTO vaults.device_lifecycle_audit(tenant_id,account_id,actor_device_id,action,outcome,detail_hash) VALUES($1,$2,$3,$4,'accepted',$5)",[auth.tenantId,auth.accountId,auth.deviceId,kind==='password'?'credential.rotate':'account_secret.rotate',Buffer.from(sha(Buffer.from(artifact.attempt)),'hex')]);
      return {credentialEpoch:epoch,deviceId:candidate.deviceId,signInRequired:true};
    });
  }
}

export function createCredentialRotationHandler({store,authenticate,origin,registration,opaque}) {
  return async(req,res) => {
    const match=new URL(req.url,origin).pathname.match(/^\/api\/v1\/devices\/rotate-(password|account-secret)(\/start)?$/);
    if (!match) return false;
    try {
      if (req.method!=='POST') { writeError(res,405,'method_not_allowed');return true; }
      const cookies=String(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(`${AUTH_COOKIE}=`));
      if(cookies.length!==1)throw new AuthError();
      const auth=await authenticate(cookies[0].slice(AUTH_COOKIE.length+1));
      requireUnsafeRequest(req,origin,req.headers['x-127v-csrf'],auth.csrf);
      const kind=match[1],purpose=kind==='password'?'password-rotation':'secret-rotation';
      const value=parseJsonObject(req,await readRequestBody(req,64*1024),match[2]?['request','deviceId']:['candidate','authorizationSignature','settings']);
      if (match[2]) {
        if(!uuid(value.deviceId) || kind==='password'&&value.deviceId!==auth.deviceId)throw new AuthError(400);
        const epoch=await store.prepare(auth);
        writeJson(res,200,await registration.startRotation({accountId:auth.accountId,deviceId:value.deviceId,request:value.request},
          {purpose,credentialEpoch:epoch,sessionId:auth.sessionId,approverDeviceId:auth.deviceId}));
      } else {
        if (!value.candidate || Object.keys(value.candidate).sort().join(',')!=='accountId,activationSignature,deviceId,opaqueUpload,registrationArtifact,signingPublicKey,wrappedRootDescriptor,wrappedRootEnvelope') throw new AuthError(400);
        const artifact=registration.verifyArtifact(value.candidate,purpose);
        const candidate=await createRegistrationCompletion(opaque,registration,purpose)(value.candidate);
        writeJson(res,200,await store.commit(auth,{kind,candidate,artifact,authorizationSignature:value.authorizationSignature,settings:value.settings}));
      }
    } catch(error) {
      const status=error instanceof AuthError || error instanceof HttpBoundaryError?error.status:503;
      writeError(res,status,status===401?'authentication_required':status===403?'fresh_device_auth_required':status===503?'unavailable':'invalid_request');
    }
    return true;
  };
}

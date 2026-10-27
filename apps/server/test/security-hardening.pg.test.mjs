import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';
import { schemaSql, schemaV9Checksum, schemaV10MigrationSql, requireSchema } from '../src/schema.mjs';
import { migrateSchema9To10, schemaStatus } from '../src/schema-migration.mjs';
import { AuthService } from '../src/auth-service.mjs';
import { PgAuthStore } from '../src/auth-pg.mjs';
import { deviceProofBytes } from '../src/auth-policy.mjs';
import { OpaqueAdapter, RegistrationAdapter, createRegistrationCompletion } from '../src/opaque-adapter.mjs';
import { PgOnboardingStore } from '../src/onboarding-pg.mjs';
import { OnboardingService, newInviteToken, decodeToken, tokenDigest } from '../src/onboarding.mjs';
import { PgDeviceLifecycleStore } from '../src/device-lifecycle-pg.mjs';
import { PgPrivateVaultStore } from '../src/private-vault-pg.mjs';
import { PgSignedSyncStore } from '../src/sync-pg.mjs';
import { PgCredentialRotationStore, credentialRotationBytes, credentialPreparationBytes, createCredentialRotationHandler } from '../src/credential-rotation.mjs';
import { registrationActivationBytes } from '../src/opaque-adapter.mjs';
import { PgVaultSettingsStore, createVaultSettingsHandler } from '../src/vault-settings-handler.mjs';

const url=process.env.VAULTS_SECURITY_DATABASE_URL;
const b64=value=>Buffer.from(value).toString('base64url');
const bytes=value=>Buffer.from(value,'base64url');
const id=value=>Buffer.from(value.replaceAll('-',''),'hex');
const uuid=value=>{const h=Buffer.from(value).toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`};
const canonical=value=>Buffer.from(JSON.stringify(value,Object.keys(value).sort()));

test('offline PostgreSQL and real OPAQUE security regressions',{skip:!url,timeout:180000},async t=>{
  const target=new URL(url);
  assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/vaults_security');
  const pool=new pg.Pool({connectionString:url,max:4});t.after(()=>pool.end());
  assert.equal((await pool.query("SELECT to_regclass('vaults.schema_version') relation")).rows[0].relation,null,'requires an EMPTY disposable database');
  await pool.query(schemaSql.slice(0,-schemaV10MigrationSql.length-1));
  await pool.query('INSERT INTO vaults.schema_version(version,checksum) VALUES(9,$1)',[schemaV9Checksum]);
  const wasm=createRequire(import.meta.url)('../wasm-auth/vaults_browser_fixture.cjs');
  const bridge=wasm.ExperimentalOpaqueBridge,opaque=new OpaqueAdapter(bridge),setup=Buffer.from(bridge.server_setup());
  const publicKey=Buffer.from(bridge.server_public_key(setup)),tenant=randomUUID(),tokenKey=randomBytes(32),origin='https://127.0.0.1:12780';
  await pool.query('INSERT INTO vaults.installation(id) VALUES($1)',[tenant]);
  await pool.query('INSERT INTO vaults.opaque_server_setup(tenant_id,setup_bytes) VALUES($1,$2)',[tenant,setup]);
  const authStore=new PgAuthStore(pool,tokenKey,publicKey),authService=new AuthService({store:authStore,opaque});
  const onboarding=new OnboardingService({store:new PgOnboardingStore(pool),tokenKey});
  const registration=new RegistrationAdapter({opaque,setup,installation:tenant,serverPublicKey:publicKey,tokenKey,origin,authorizeStart:value=>onboarding.authorizeRegistration(value)});
  const core=new wasm.ExperimentalEcf1Core();t.after(()=>{core.lock();core.free()});
  async function fixture(username,role) {
    const accountId=randomUUID(),deviceId=randomUUID(),key=generateKeyPairSync('ed25519'),secret=randomBytes(32),password=Buffer.from('disposable-password-only');
    const start=bridge.client_registration_start(secret,password);
    // Fixture creation uses the same protocol and record parser, not an HTTP admission bypass.
    const prepared=await registration.startRotation({accountId,deviceId,request:b64(start.message())},{purpose:'password-rotation',credentialEpoch:1});
    const record=Buffer.from(bridge.client_registration_finish(start.state(),secret,password,bytes(prepared.response),bytes(prepared.binding)));
    const template=Buffer.alloc(77);template[0]=1;id(tenant).copy(template,1);id(accountId).copy(template,17);template.writeUInt32BE(1,65);template.writeBigUInt64BE(1n,69);
    const root=core.create_root(template,password,secret),directory=core.create_empty_directory(root);
    await pool.query("INSERT INTO vaults.accounts(tenant_id,id,username,display_name,email,server_role,enrollment_state) VALUES($1,$2,$3,$3,$4,$5,'active')",[tenant,accountId,username,`${username}@example.invalid`,role]);
    await pool.query('INSERT INTO vaults.authentication_credentials(tenant_id,account_id,opaque_record,wrapped_root_descriptor,wrapped_root_envelope) VALUES($1,$2,$3,$4,$5)',[tenant,accountId,record,Buffer.from(root.context()),Buffer.from(root.envelope())]);
    await pool.query('INSERT INTO vaults.devices(tenant_id,account_id,id,signing_public_key,credential_epoch,credential_epoch_seen) VALUES($1,$2,$3,$4,1,1)',[tenant,accountId,deviceId,key.publicKey.export({format:'der',type:'spki'}).subarray(-32)]);
    await pool.query('INSERT INTO vaults.private_directories(tenant_id,account_id,revision,directory) VALUES($1,$2,$3,$4)',[tenant,accountId,uuid(directory.slice(36,52)),Buffer.from(directory)]);
    start.free();return {accountId,deviceId,key,secret,password,username,root,directory,template};
  }
  const alice=await fixture('security_alice','owner'),bob=await fixture('security_bob','user');
  await t.test('schema 10 rehearses and migrates a populated database without changing credential ciphertext',async()=>{
    const before=(await pool.query('SELECT account_id,opaque_record,wrapped_root_descriptor,wrapped_root_envelope FROM vaults.authentication_credentials ORDER BY account_id')).rows;
    const client=await pool.connect();
    try {
      await migrateSchema9To10(client,{dryRun:true});assert.equal((await schemaStatus(client)).version,9);
      await migrateSchema9To10(client);await requireSchema(client);
      assert.deepEqual((await pool.query('SELECT account_id,opaque_record,wrapped_root_descriptor,wrapped_root_envelope FROM vaults.authentication_credentials ORDER BY account_id')).rows,before);
    } finally {client.release()}
  });
  async function login(user,password=user.password,secret=user.secret) {
    const start=bridge.client_login_start(secret,password);
    try {
      const begun=await authService.start({username:user.username,deviceId:user.deviceId,request:b64(start.message()),origin,source:'login-fixture'});
      const finish=bridge.client_login_finish(start.state(),secret,password,bytes(begun.challenge),bytes(begun.binding));
      try {
        const cap=await authService.finishPassword({attemptId:begun.attemptId,finalization:b64(finish.message())});
        await authService.consumeRoot({attemptId:begun.attemptId,capability:cap.capability});
        const pending=await authStore.deviceAttempt({attempt:bytes(begun.attemptId),now:new Date()});
        const session=await authService.finishDevice({attemptId:begun.attemptId,signature:b64(sign(null,deviceProofBytes(pending.proofFields),user.key.privateKey))});
        return {...await authService.authenticate(session.token),token:session.token};
      } finally {finish.free()}
    } finally {start.free()}
  }
  function preparation(auth,user,kind,request,deviceId=user.deviceId) {
    const value={kind,origin,request,deviceId,nonce:b64(randomBytes(32)),issuedAt:Date.now()};
    return {...value,authorizationSignature:b64(sign(null,credentialPreparationBytes({auth,...value}),user.key.privateKey))};
  }
  let aliceAuth,bobAuth;
  await t.test('real sign-in binds each session to its own account and device',async()=>{
    aliceAuth=await login(alice);bobAuth=await login(bob);
    assert.equal(aliceAuth.accountId,alice.accountId);assert.equal(bobAuth.accountId,bob.accountId);
    assert.notEqual(aliceAuth.sessionId,bobAuth.sessionId);
  });
  await t.test('registration requires an invitation and refuses an existing account before evaluating OPAQUE',async()=>{
    const token=newInviteToken(),inviteId=randomUUID(),email='new-member@example.invalid';
    await pool.query("INSERT INTO vaults.invitation_records(tenant_id,id,token_digest,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[tenant,inviteId,tokenDigest(tokenKey,'invite',decodeToken(token,'127V-I1-')),alice.accountId]);
    await pool.query('INSERT INTO vaults.invitation_emails(tenant_id,id,email) VALUES($1,$2,$3)',[tenant,inviteId,email]);
    let evaluated=0;const original=opaque.serverRegistrationStart.bind(opaque);
    opaque.serverRegistrationStart=value=>{evaluated++;return original(value)};
    const step=bridge.client_registration_start(randomBytes(32),Buffer.from('dummy-password'));
    const input={accountId:alice.accountId,deviceId:randomUUID(),request:b64(step.message()),token,email,source:'registration-fixture'};
    try {
      await assert.rejects(registration.start(input));assert.equal(evaluated,0);
      await assert.rejects(registration.start({...input,accountId:randomUUID(),token:newInviteToken()}));assert.equal(evaluated,0);
      assert.ok((await registration.start({...input,accountId:randomUUID()})).registrationArtifact);assert.equal(evaluated,1);
    } finally {opaque.serverRegistrationStart=original;step.free()}
  });
  await t.test('five unsolicited enrollments cannot occupy the victim admission capacity',async()=>{
    const store=new PgDeviceLifecycleStore(pool),keys=generateKeyPairSync('ed25519'),publicKey=b64(keys.publicKey.export({format:'der',type:'spki'}).subarray(-32));
    const request=async(username,source)=>{
      const newDeviceId=randomUUID(),value={deviceId:newDeviceId,publicKey,purpose:'enrollment-request',username};
      return store.requestEnrollment({username,newDeviceId,newDevicePublicKey:publicKey,requestSignature:b64(sign(null,canonical(value),keys.privateKey)),source});
    };
    for(let i=0;i<5;i++)await request(alice.username,'unsolicited-source');
    const legitimate=await request(alice.username,'legitimate-source');assert.ok(legitimate.enrollmentId);
    await assert.rejects(store.inspectEnrollment(bobAuth,{code:legitimate.code}));
    const binding=await store.inspectEnrollment(aliceAuth,{code:legitimate.code});
    await store.approveEnrollmentRequest(aliceAuth,{enrollmentId:legitimate.enrollmentId,approvalSignature:b64(sign(null,canonical(binding),alice.key.privateKey))});
    assert.equal((await store.completeEnrollmentRequest({...legitimate,possessionSignature:b64(sign(null,canonical({...binding,purpose:'device-possession'}),keys.privateKey))})).deviceId,binding.newDeviceId);
    for(let i=0;i<5;i++)await request(alice.username,'unsolicited-source');
    await assert.rejects(request(alice.username,'unsolicited-source'),{code:'RATE_LIMITED'});
    const absent=await request('not_registered','another-source');assert.deepEqual(Object.keys(absent).sort(),Object.keys(legitimate).sort());
    assert.deepEqual(await store.pollEnrollment(absent),{status:'pending'});
  });
  await t.test('abandoning KE2 consumes the failure reservation; unknown devices receive fake credentials',async()=>{
    const step=bridge.client_login_start(alice.secret,alice.password);
    try {
      await authService.start({username:alice.username,deviceId:alice.deviceId,request:b64(step.message()),origin,source:'abandoned-fixture'});
      assert.equal((await pool.query('SELECT consecutive FROM vaults.authentication_failures WHERE tenant_id=$1 AND account_id=$2',[tenant,alice.accountId])).rows[0].consecutive,1);
      const unknown=randomUUID(),input={username:alice.username,deviceId:unknown,source:'fake-fixture',now:new Date()};
      const a=await authStore.loginMaterial(input),b=await authStore.loginMaterial(input);
      assert.equal(a.binding.account,b.binding.account);assert.notEqual(a.binding.account,alice.accountId);assert.equal(a.record,null);
      const missing={...input,username:'absent_person'};
      assert.equal((await authStore.loginMaterial(missing)).binding.account,(await authStore.loginMaterial(missing)).binding.account);
      aliceAuth=await login(alice);
      assert.equal((await pool.query('SELECT consecutive FROM vaults.authentication_failures WHERE account_id=$1',[alice.accountId])).rows[0].consecutive,0);
    } finally {step.free()}
  });
  await t.test('receipt budgets are per account, roll forward and retain cross-account ownership checks',async()=>{
    await pool.query("INSERT INTO vaults.private_receipts(tenant_id,account_id,request_id,fingerprint,response,created_at) SELECT $1,$2,gen_random_uuid(),decode(repeat('00',32),'hex'),'{}',now()-interval '2 minutes' FROM generate_series(1,10000)",[tenant,alice.accountId]);
    const store=new PgPrivateVaultStore(pool,new PgSignedSyncStore(pool,generateKeyPairSync('ed25519').privateKey));
    const make=async(user,auth)=>{
      const made=core.create_private_vault(user.root,user.directory);
      return store.mutate({auth,method:'POST',path:'/api/v1/vaults',raw:randomBytes(16),requestId:randomUUID(),baseDirectoryRevision:uuid(user.directory.slice(36,52)),directoryBytes:Buffer.from(made.directory()),vaultEnvelope:Buffer.from(made.vault().envelope()),catalogueBytes:Buffer.from(made.catalogue()),action:'vault.create'});
    };
    await make(bob,bobAuth);
    await pool.query("INSERT INTO vaults.private_receipts(tenant_id,account_id,request_id,fingerprint,response) SELECT $1,$2,gen_random_uuid(),decode(repeat('00',32),'hex'),'{}' FROM generate_series(1,99)",[tenant,bob.accountId]);
    await assert.rejects(make(bob,bobAuth),{code:'RATE_LIMITED'});
    await make(alice,aliceAuth);
    const vault=(await pool.query('SELECT id FROM vaults.private_vaults WHERE account_id=$1',[alice.accountId])).rows[0].id;
    await assert.rejects(store.items(bobAuth,vault),{code:'NOT_FOUND'});
  });
  await t.test('signed rotation replaces OPAQUE material, rejects cross-account authorization and revokes old sessions',async()=>{
    const store=new PgCredentialRotationStore(pool),password=Buffer.from('replacement-password-only');
    const step=bridge.client_registration_start(alice.secret,password);
    const epoch=await store.prepare(aliceAuth,preparation(aliceAuth,alice,'password',b64(step.message())));
    const prepared=await registration.startRotation({accountId:alice.accountId,deviceId:alice.deviceId,request:b64(step.message())},
      {purpose:'password-rotation',credentialEpoch:epoch,sessionId:aliceAuth.sessionId,approverDeviceId:alice.deviceId});
    const record=Buffer.from(bridge.client_registration_finish(step.state(),alice.secret,password,bytes(prepared.response),bytes(prepared.binding)));
    const template=Buffer.from(alice.template);template.writeBigUInt64BE(BigInt(epoch),69);
    const root=core.create_root(template,password,alice.secret);
    const candidate={accountId:alice.accountId,deviceId:alice.deviceId,signingPublicKey:b64(alice.key.publicKey.export({format:'der',type:'spki'}).subarray(-32)),opaqueUpload:b64(record),wrappedRootDescriptor:b64(root.context()),wrappedRootEnvelope:b64(root.envelope()),registrationArtifact:prepared.registrationArtifact};
    candidate.activationSignature=b64(sign(null,registrationActivationBytes(candidate,record),alice.key.privateKey));
    const artifact=registration.verifyArtifact(candidate,'password-rotation');
    const completed=await createRegistrationCompletion(opaque,registration,'password-rotation')(candidate);
    const input={kind:'password',candidate:completed,artifact,authorizationSignature:b64(sign(null,credentialRotationBytes({auth:aliceAuth,kind:'password',epoch,candidate:completed,artifact}),alice.key.privateKey))};
    await assert.rejects(store.commit(bobAuth,input));
    await assert.rejects(store.commit(aliceAuth,{...input,authorizationSignature:b64(sign(null,credentialRotationBytes({auth:aliceAuth,kind:'password',epoch,candidate:completed,artifact}),bob.key.privateKey))}));
    assert.equal((await store.commit(aliceAuth,input)).credentialEpoch,2);
    await assert.rejects(new PgVaultSettingsStore(pool).put(aliceAuth,{baseRevision:null,revision:randomUUID(),envelope:Buffer.alloc(174)}),{status:401});
    await assert.rejects(authService.authenticate(aliceAuth.token));
    await assert.rejects(store.commit(aliceAuth,input));
    assert.equal((await authService.authenticate(bobAuth.token)).accountId,bob.accountId);
    await assert.rejects(login(alice));
    alice.password=password;aliceAuth=await login(alice);
    assert.equal(aliceAuth.credentialEpoch,2);
    const stale=(await pool.query("SELECT count(*)::int n FROM vaults.sessions WHERE account_id=$1 AND credential_epoch=1 AND revoked_at IS NULL",[alice.accountId])).rows[0].n;
    assert.equal(stale,0);step.free();
  });
  await t.test('account-secret rotation requires both devices proofs and retires all prior devices',async()=>{
    const store=new PgCredentialRotationStore(pool);
    await pool.query("UPDATE vaults.sessions SET created_at=now()-interval '10 minutes',expires_at=now()+interval '1 hour' WHERE session_id=$1",[aliceAuth.sessionId]);
    await assert.rejects(store.prepare(aliceAuth,{}),{status:403});
    await pool.query('UPDATE vaults.sessions SET created_at=now() WHERE session_id=$1',[aliceAuth.sessionId]);
    const secret=randomBytes(32),replacement=generateKeyPairSync('ed25519'),deviceId=randomUUID();
    const step=bridge.client_registration_start(secret,alice.password);
    const epoch=await store.prepare(aliceAuth,preparation(aliceAuth,alice,'account-secret',b64(step.message()),deviceId));
    const prepared=await registration.startRotation({accountId:alice.accountId,deviceId,request:b64(step.message())},
      {purpose:'secret-rotation',credentialEpoch:epoch,sessionId:aliceAuth.sessionId,approverDeviceId:aliceAuth.deviceId});
    const record=Buffer.from(bridge.client_registration_finish(step.state(),secret,alice.password,bytes(prepared.response),bytes(prepared.binding)));
    const template=Buffer.from(alice.template);template.writeBigUInt64BE(BigInt(epoch),69);
    const root=core.create_root(template,alice.password,secret);
    const candidate={accountId:alice.accountId,deviceId,signingPublicKey:b64(replacement.publicKey.export({format:'der',type:'spki'}).subarray(-32)),opaqueUpload:b64(record),wrappedRootDescriptor:b64(root.context()),wrappedRootEnvelope:b64(root.envelope()),registrationArtifact:prepared.registrationArtifact};
    candidate.activationSignature=b64(sign(null,registrationActivationBytes(candidate,record),replacement.privateKey));
    await assert.rejects(createRegistrationCompletion(opaque,registration,'password-rotation')(candidate));
    const artifact=registration.verifyArtifact(candidate,'secret-rotation'),completed=await createRegistrationCompletion(opaque,registration,'secret-rotation')(candidate);
    const oldSettings=core.encrypt_account_settings(alice.root,Buffer.from('{"version":1}'));
    const baseRevision=uuid(oldSettings.slice(76,92));
    await pool.query('INSERT INTO vaults.private_account_settings(tenant_id,account_id,revision,envelope) VALUES($1,$2,$3,$4)',[tenant,alice.accountId,baseRevision,Buffer.from(oldSettings)]);
    const updatedSettings=core.encrypt_account_settings(root,Buffer.from('{"version":1}'));
    const settings={baseRevision,revision:uuid(updatedSettings.slice(76,92)),envelope:b64(updatedSettings)};
    const authorize=settings=>b64(sign(null,credentialRotationBytes({auth:aliceAuth,kind:'account-secret',epoch,candidate:completed,artifact,settings}),alice.key.privateKey));
    await assert.rejects(store.commit(aliceAuth,{kind:'account-secret',candidate:completed,artifact,authorizationSignature:authorize(null)}));
    await store.commit(aliceAuth,{kind:'account-secret',candidate:completed,artifact,settings,authorizationSignature:authorize(settings)});
    assert.equal((await pool.query("SELECT count(*)::int n FROM vaults.devices WHERE account_id=$1 AND lifecycle_status='active'",[alice.accountId])).rows[0].n,1);
    await assert.rejects(authService.authenticate(aliceAuth.token));
    await assert.rejects(login(alice));
    const oldSecret=alice.secret;alice.deviceId=deviceId;alice.key=replacement;alice.secret=secret;
    await assert.rejects(login(alice,alice.password,oldSecret));
    aliceAuth=await login(alice);assert.equal(aliceAuth.credentialEpoch,3);
    const stored=(await pool.query('SELECT envelope FROM vaults.private_account_settings WHERE account_id=$1',[alice.accountId])).rows[0].envelope;
    assert.equal(Buffer.from(core.decrypt_account_settings(root,stored)).toString(),'{"version":1}');
    step.free();
  });
  await t.test('rotation preparation rejects missing device proof, replay, altered requests and excess evaluations',async()=>{
    const user=await fixture('security_rotation','user'),auth=await login(user),store=new PgCredentialRotationStore(pool);
    const step=bridge.client_registration_start(user.secret,user.password);
    try {
      const request=b64(step.message()),proof=preparation(auth,user,'password',request);
      await assert.rejects(store.prepare(auth,{...proof,authorizationSignature:undefined}));
      await assert.rejects(store.prepare(auth,{...proof,request:b64(randomBytes(32))}));
      await assert.rejects(store.prepare(auth,{...proof,origin:'https://other.invalid'}));
      await assert.rejects(store.prepare(auth,{...proof,issuedAt:Date.now()-180000}));
      const another=await login(user);
      await assert.rejects(store.prepare(another,proof));
      assert.equal(await store.prepare(auth,proof),2);
      await assert.rejects(store.prepare(auth,proof),{status:403});
      for(let i=0;i<4;i++)assert.equal(await store.prepare(auth,preparation(auth,user,'password',request)),2);
      await assert.rejects(store.prepare(auth,preparation(auth,user,'password',request)),{status:429});
    } finally {step.free()}
  });
  await t.test('a previously authenticated principal cannot write after logout, suspension or device revocation',async()=>{
    const user=await fixture('security_revocation','user'),store=new PgVaultSettingsStore(pool);
    for(const invalidate of [
      auth=>authService.logout(auth.token),
      ()=>pool.query('UPDATE vaults.accounts SET suspended_at=now(),session_epoch=session_epoch+1 WHERE id=$1',[user.accountId]),
      ()=>pool.query("UPDATE vaults.devices SET lifecycle_status='revoked',auth_epoch=auth_epoch+1,revoked_at=now() WHERE id=$1",[user.deviceId])
    ]) {
      const auth=await login(user);
      // Pause the HTTP body after authentication, exactly at the original race.
      let release,entered;
      const gate=new Promise(done=>release=done),waiting=new Promise(done=>entered=done);
      const envelope=Buffer.from(core.encrypt_account_settings(user.root,Buffer.from('{"version":1}')));
      const body=Buffer.from(JSON.stringify({baseRevision:null,revision:uuid(envelope.subarray(76,92)),envelope:b64(envelope)}));
      const req={url:'/api/v1/vault-settings',method:'PUT',headers:{origin,'content-type':'application/json',cookie:`__Host-127v-session=${auth.token}`,'x-127v-csrf':auth.csrf},
        async *[Symbol.asyncIterator](){entered();await gate;yield body;}};
      const res={writeHead(status){this.status=status;},end(){}};
      const pending=createVaultSettingsHandler(store,token=>authService.authenticate(token),origin)(req,res);
      await waiting;
      await invalidate(auth);
      await assert.rejects(authService.authenticate(auth.token));
      release();await pending;assert.equal(res.status,401);
      await assert.rejects(store.put(auth,{baseRevision:null,revision:randomUUID(),envelope:Buffer.alloc(174)}),{status:401});
      assert.equal((await pool.query('SELECT count(*)::int n FROM vaults.private_account_settings WHERE account_id=$1',[user.accountId])).rows[0].n,0);
      await pool.query('UPDATE vaults.accounts SET suspended_at=NULL WHERE id=$1',[user.accountId]);
    }
  });
});

// Disposable PostgreSQL acceptance for the internal Cloud database boundary.
// Run explicitly with VAULTS_INTERNAL_CLOUD_LIVE_TEST=1; never targets a named
// installation or an existing volume.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createCipheriv, createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { activateCloudTenant, initializeCloudDatabase, issueCloudBootstrapToken, linkCloudControlOwner, prepareCloudTenant, reserveCloudTenant, verifyCloudDatabase } from '../apps/server/internal-cloud/operator.mjs';
import { requireSchema } from '../apps/server/src/schema.mjs';
import { createTenantScopedPool, verifyCloudRuntimeRole } from '../apps/server/internal-cloud/scoped-pool.mjs';
import { createInternalCloudEnrollmentBoundary, createInternalCloudRequestBoundary } from '../apps/server/internal-cloud/request-boundary.mjs';
import { PgAuthStore } from '../apps/server/src/auth-pg.mjs';
import { createInternalCloudEnrollmentHandlers, createInternalCloudTenantHandlers } from '../apps/server/internal-cloud/tenant-handlers.mjs';
import { registrationActivationBytes } from '../apps/server/src/opaque-adapter.mjs';
const pg = createRequire(new URL('../apps/server/package.json', import.meta.url))('pg');

if (process.env.VAULTS_INTERNAL_CLOUD_LIVE_TEST !== '1') throw new Error('Explicit disposable-test opt-in required.');
const name = `vaults-cloud-test-${randomBytes(5).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const run = (...args) => execFileSync('podman', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trim();
let started = false;
let admin;
let runtimePool;
try {
  run('run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::5432', '-e', `POSTGRES_PASSWORD=${password}`,
    '-e', 'POSTGRES_USER=cloud_operator', '-e', 'POSTGRES_DB=vaults_cloud_test', 'postgres:17-bookworm');
  started = true;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { run('exec', name, 'pg_isready', '-U', 'cloud_operator', '-d', 'vaults_cloud_test'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not start.');
  const port = Number(run('port', name, '5432/tcp').match(/:(\d+)$/)?.[1]);
  if (!Number.isInteger(port)) throw new Error('Disposable PostgreSQL port unavailable.');
  for (let i = 0; i < 30; i++) {
    const candidate = new pg.Client({ host: '127.0.0.1', port, user: 'cloud_operator', password, database: 'vaults_cloud_test' });
    candidate.on('error', () => {});
    try {
      await candidate.connect();
      await candidate.query('SELECT 1');
      await new Promise(resolve => setTimeout(resolve, 300));
      await candidate.query('SELECT 1');
      admin = candidate;
      break;
    } catch {
      await candidate.end().catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!admin) throw new Error('Disposable PostgreSQL TCP service did not stabilize.');
  await initializeCloudDatabase(admin, 'asia');
  await verifyCloudDatabase(admin, 'asia');
  await assert.rejects(requireSchema(admin), /Cloud database cannot be served/);
  const alice = await reserveCloudTenant(admin, { region: 'asia', host: 'alice.asia.example.com' });
  const bob = await reserveCloudTenant(admin, { region: 'asia', host: 'bob.asia.example.com' });
  assert.notEqual(alice.id, bob.id);
  assert.equal((await reserveCloudTenant(admin, { region: 'asia', host: alice.host })).id, alice.id);
  await assert.rejects(activateCloudTenant(admin, { region: 'asia', host: alice.host }), /not prepared/);
  await prepareCloudTenant(admin, { region: 'asia', host: alice.host, setupBytes: Buffer.alloc(96) });
  await prepareCloudTenant(admin, { region: 'asia', host: bob.host, setupBytes: Buffer.alloc(96) });
  assert.equal((await prepareCloudTenant(admin, { region: 'asia', host: alice.host, setupBytes: Buffer.alloc(96) })).reused, true);
  await assert.rejects(activateCloudTenant(admin, { region: 'asia', host: alice.host }), /control owner is required/);
  const controlOwners = new Map();
  for (const tenant of [alice, bob]) {
    const ownerIdentityId = randomUUID(), ownerEmail = `admin-${tenant.host.split('.')[0]}@example.com`;
    controlOwners.set(tenant.id, { ownerIdentityId, ownerEmail });
    await linkCloudControlOwner(admin, { region: 'asia', host: tenant.host, ownerIdentityId, ownerEmail });
  }
  assert.equal((await linkCloudControlOwner(admin, { region: 'asia', host: alice.host, ...controlOwners.get(alice.id) })).reused, true);
  await assert.rejects(linkCloudControlOwner(admin, { region: 'asia', host: alice.host,
    ownerIdentityId: randomUUID(), ownerEmail: 'other@example.com' }), /another identity/);
  assert.equal((await admin.query('SELECT count(*)::int n FROM vaults.accounts')).rows[0].n, 0);
  await assert.rejects(activateCloudTenant(admin, { region: 'asia', host: alice.host }), /owner enrollment is incomplete/);
  await admin.query(`INSERT INTO vaults.accounts(tenant_id,id,username,display_name,email,server_role,enrollment_state)
    VALUES($1,$1,'alice1','Alice','alice@example.com','owner','active'),($2,$2,'bobby1','Bob','bob@example.com','owner','active')`, [alice.id, bob.id]);
  await admin.query(`INSERT INTO vaults.authentication_credentials(tenant_id,account_id,opaque_record,wrapped_root_descriptor,wrapped_root_envelope)
    VALUES($1,$1,$3,$4,$4),($2,$2,$3,$4,$4)`, [alice.id, bob.id, Buffer.alloc(192), Buffer.alloc(1)]);
  await admin.query(`INSERT INTO vaults.bootstrap_tokens(tenant_id,token_digest,expires_at,consumed_at)
    VALUES($1,$3,now()+interval '1 hour',now()),($2,$3,now()+interval '1 hour',now())`, [alice.id, bob.id, Buffer.alloc(32)]);
  await admin.query(`INSERT INTO vaults.devices(tenant_id,account_id,id,signing_public_key,credential_epoch,credential_epoch_seen)
    VALUES($1,$1,$2,$3,1,1)`, [alice.id, randomUUID(), Buffer.alloc(32)]);
  assert.equal((await activateCloudTenant(admin, { region: 'asia', host: alice.host })).state, 'active');
  assert.equal((await activateCloudTenant(admin, { region: 'asia', host: alice.host })).reused, true);
  await admin.query(`CREATE ROLE cloud_test_login LOGIN PASSWORD '${password}'`);
  await admin.query('GRANT vaults_cloud_runtime TO cloud_test_login');
  runtimePool = new pg.Pool({ host: '127.0.0.1', port, user: 'cloud_test_login', password,
    database: 'vaults_cloud_test', max: 1 });
  await verifyCloudRuntimeRole(runtimePool);
  assert.equal((await runtimePool.query('SELECT count(*)::int AS n FROM vaults.accounts')).rows[0].n, 0);
  assert.deepEqual((await createTenantScopedPool(runtimePool, alice.id).query('SELECT tenant_id FROM vaults.accounts')).rows.map(x => x.tenant_id), [alice.id]);
  assert.deepEqual((await createTenantScopedPool(runtimePool, bob.id).query('SELECT tenant_id FROM vaults.accounts')).rows.map(x => x.tenant_id), [bob.id]);
  assert.equal((await runtimePool.query('SELECT count(*)::int AS n FROM vaults.accounts')).rows[0].n, 0);
  const authStore = new PgAuthStore(createTenantScopedPool(runtimePool, alice.id), Buffer.alloc(32), Buffer.alloc(32), { tenantId: alice.id });
  const material = await authStore.loginMaterial({ username: 'unknown1', deviceId: randomUUID(), source: '127.0.0.1', now: new Date() });
  assert.equal(material.tenantId, alice.id);
  assert.equal(material.binding.installation, alice.id);
  assert.equal((await createTenantScopedPool(runtimePool, alice.id).query('SELECT count(*)::int AS n FROM vaults.authentication_rate_limits WHERE tenant_id=$1', [alice.id])).rows[0].n, 1);
  const bobDevice = randomUUID(), sessionToken = randomBytes(32), csrf = randomBytes(32), tokenKey = Buffer.alloc(32);
  const tokenDigest = createHmac('sha256', tokenKey).update('session').update('\0').update(sessionToken).digest();
  const csrfDigest = createHmac('sha256', tokenKey).update('csrf').update('\0').update(csrf).digest();
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', tokenKey, nonce);
  const csrfBody = Buffer.concat([cipher.update(csrf), cipher.final()]);
  const csrfCipher = Buffer.concat([nonce, cipher.getAuthTag(), csrfBody]);
  await admin.query(`INSERT INTO vaults.devices(tenant_id,account_id,id,signing_public_key,credential_epoch,credential_epoch_seen)
    VALUES($1,$1,$2,$3,1,1)`, [bob.id, bobDevice, Buffer.alloc(32)]);
  await admin.query(`INSERT INTO vaults.sessions(tenant_id,token_digest,account_id,device_id,credential_epoch,csrf_digest,csrf_cipher,expires_at)
    VALUES($1,$2,$1,$3,1,$4,$5,now()+interval '1 hour')`, [bob.id, tokenDigest, bobDevice, csrfDigest, csrfCipher]);
  await assert.rejects(authStore.authenticate({ token: sessionToken, now: new Date() }));
  const bobAuth = new PgAuthStore(createTenantScopedPool(runtimePool, bob.id), tokenKey, Buffer.alloc(32), { tenantId: bob.id });
  assert.equal((await bobAuth.authenticate({ token: sessionToken, now: new Date() })).tenantId, bob.id);
  await admin.query('SET ROLE vaults_cloud_runtime');
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM vaults.accounts')).rows[0].n, 0);
  await assert.rejects(admin.query('SELECT * FROM cloud.tenants'), /permission denied/);
  assert.equal((await admin.query('SELECT cloud.resolve_tenant($1,$2) AS id', [bob.host, 'asia'])).rows[0].id, null);
  await admin.query('BEGIN');
  await admin.query("SELECT set_config('vaults.tenant_id',$1,true)", [alice.id]);
  assert.deepEqual((await admin.query('SELECT tenant_id FROM vaults.accounts')).rows.map(x => x.tenant_id), [alice.id]);
  assert.deepEqual((await admin.query('SELECT id FROM vaults.installation')).rows.map(x => x.id), [alice.id]);
  assert.equal((await admin.query('SELECT vaults.reserve_onboarding_attempt($1,$2,now(),$3) AS allowed', [bob.id, 'source', randomUUID()])).rows[0].allowed, false);
  assert.equal((await admin.query('SELECT vaults.reserve_onboarding_attempt($1,$2,now(),$3) AS allowed', [alice.id, 'source', randomUUID()])).rows[0].allowed, true);
  assert.deepEqual((await admin.query('SELECT DISTINCT tenant_id FROM vaults.onboarding_rate_limits')).rows.map(x => x.tenant_id), [alice.id]);
  await admin.query('COMMIT');
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM vaults.accounts')).rows[0].n, 0);
  await admin.query('BEGIN');
  await admin.query("SELECT set_config('vaults.tenant_id',$1,true)", [alice.id]);
  await assert.rejects(admin.query(`INSERT INTO vaults.accounts(tenant_id,id,username,display_name,email,server_role)
    VALUES($1,$1,'intruder','Intruder','intruder@example.com','user')`, [bob.id]), /row-level security policy/);
  await admin.query('ROLLBACK');
  await admin.query('RESET ROLE');
  await admin.query('BEGIN');
  await activateCloudTenant(admin, { region: 'asia', host: alice.host });
  await admin.query('SET ROLE vaults_cloud_runtime');
  assert.equal((await admin.query('SELECT cloud.resolve_tenant($1,$2) AS id', [alice.host, 'asia'])).rows[0].id, alice.id);
  assert.equal((await admin.query('SELECT cloud.resolve_tenant($1,$2) AS id', [alice.host, 'europe'])).rows[0].id, null);
  await admin.query('RESET ROLE');
  await admin.query('ROLLBACK');
  await admin.query("UPDATE cloud.tenants SET state='active',activated_at=now() WHERE id=$1", [alice.id]);
  const boundary = await createInternalCloudRequestBoundary({ pool: runtimePool, region: 'asia',
    handle: async (_req, _res, context) => {
      const rows = (await context.pool.query('SELECT tenant_id FROM vaults.accounts')).rows;
      assert.deepEqual(rows.map(x => x.tenant_id), [alice.id]);
      return context.tenant.id;
    } });
  const request = { rawHeaders: ['Host', alice.host], headers: { host: alice.host, origin: `https://${alice.host}` },
    socket: { encrypted: true, servername: alice.host } };
  assert.equal(await boundary(request, {}), alice.id);
  await assert.rejects(boundary({ ...request, rawHeaders: ['Host', bob.host],
    headers: { host: bob.host, origin: `https://${bob.host}` }, socket: { encrypted: true, servername: bob.host } }, {}));
  await activateCloudTenant(admin, { region: 'asia', host: bob.host });
  let deliveredCode;
  const api = await createInternalCloudRequestBoundary({ pool: runtimePool, region: 'asia',
    handle: createInternalCloudTenantHandlers({ bridge: { server_public_key: () => Buffer.alloc(32),
      server_registration_start: () => Buffer.alloc(64), server_registration_finish: upload => upload },
      tokenKey, checkpointPrivateKey: {}, checkpointPublicKey: 'test-key',
      mailer: { sendCode: async ({ code }) => { deliveredCode = code; } } }) });
  const discover = async tenant => {
    let status, body;
    await api({ method: 'GET', url: '/api/v1/cloud/discovery', rawHeaders: ['Host', tenant.host],
      headers: { host: tenant.host }, socket: { encrypted: true, servername: tenant.host } },
    { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } });
    return { status, body };
  };
  for (const tenant of [alice, bob]) {
    const result = await discover(tenant);
    assert.equal(result.status, 200);
    assert.equal(result.body.tenantId, tenant.id);
    assert.equal(result.body.canonicalOrigin, `https://${tenant.host}`);
    assert.equal(result.body.region, 'asia');
  }
  const callDevices = async (tenantHost) => {
    let status, body;
    const req = { method: 'GET', url: '/api/v1/devices', rawHeaders: ['Host', tenantHost],
      headers: { host: tenantHost, origin: `https://${tenantHost}`, cookie: `__Host-127v-session=${sessionToken.toString('base64url')}` },
      socket: { encrypted: true, servername: tenantHost } };
    const res = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
    await api(req, res);
    return { status, body };
  };
  const ownDevices = await callDevices(bob.host);
  assert.equal(ownDevices.status, 200);
  assert.deepEqual(ownDevices.body.devices.map(x => x.deviceId), [bobDevice]);
  assert.deepEqual(await callDevices(alice.host), { status: 401, body: { error: 'authentication_required' } });
  const callInvite = async tenantHost => {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ emails: ['new@example.com'], expiresInHours: 24 }))]), {
      method: 'POST', url: '/api/v1/invitations', rawHeaders: ['Host', tenantHost],
      headers: { host: tenantHost, origin: `https://${tenantHost}`, 'content-type': 'application/json',
        'x-127v-csrf': csrf.toString('base64url'), cookie: `__Host-127v-session=${sessionToken.toString('base64url')}` },
      socket: { encrypted: true, servername: tenantHost, remoteAddress: '127.0.0.1' }
    });
    let status, body;
    const res = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
    await api(req, res);
    return { status, body };
  };
  const invited = await callInvite(bob.host);
  assert.equal(invited.status, 200);
  assert.equal((await createTenantScopedPool(runtimePool, bob.id).query('SELECT count(*)::int n FROM vaults.invitation_records')).rows[0].n, 1);
  assert.equal((await callInvite(alice.host)).status, 400);
  const apiCall = async (tenant, path, value, csrfValue) => {
    const headers = { host: tenant.host, origin: `https://${tenant.host}` };
    if (value) { headers['content-type'] = 'application/json'; headers['x-127v-csrf'] = csrfValue; headers.cookie = `__Host-127v-ceremony=${csrfValue}`; }
    const req = Object.assign(Readable.from(value ? [Buffer.from(JSON.stringify(value))] : []), {
      method: value ? 'POST' : 'GET', url: path, rawHeaders: ['Host', tenant.host], headers,
      socket: { encrypted: true, servername: tenant.host, remoteAddress: '127.0.0.1' }
    });
    let status, body;
    const res = { writeHead(code) { status = code; }, end(data) { body = JSON.parse(data); } };
    await api(req, res);
    return { status, body };
  };
  const inviteCeremony = await apiCall(bob, '/api/v1/ceremony');
  const invitedKeys = generateKeyPairSync('ed25519');
  const invitedAccountId = randomUUID(), invitedDeviceId = randomUUID();
  const inviteRegistration = await apiCall(bob, '/api/v1/onboarding/register', {
    accountId: invitedAccountId, deviceId: invitedDeviceId, request: Buffer.alloc(32).toString('base64url')
  }, inviteCeremony.body.csrf);
  assert.equal(inviteRegistration.status, 200);
  const invitedCandidate = { accountId: invitedAccountId, deviceId: invitedDeviceId, username: 'newuser1',
    displayName: 'New User', email: 'new@example.com',
    signingPublicKey: invitedKeys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url'),
    opaqueUpload: Buffer.alloc(192, 3).toString('base64url'), wrappedRootDescriptor: Buffer.alloc(8, 3).toString('base64url'),
    wrappedRootEnvelope: Buffer.alloc(16, 3).toString('base64url'), registrationArtifact: inviteRegistration.body.registrationArtifact };
  invitedCandidate.activationSignature = sign(null, registrationActivationBytes({ ...invitedCandidate,
    opaqueRecord: invitedCandidate.opaqueUpload }, Buffer.from(invitedCandidate.opaqueUpload, 'base64url')),
  invitedKeys.privateKey).toString('base64url');
  const begunInvitation = await apiCall(bob, '/api/v1/onboarding/invitation', {
    token: invited.body.token, email: 'new@example.com', candidate: invitedCandidate
  }, inviteCeremony.body.csrf);
  assert.equal(begunInvitation.status, 200);
  const { attemptId, capability } = begunInvitation.body;
  assert.equal((await apiCall(bob, `/api/v1/onboarding/invitation/${attemptId}/email`, { capability }, inviteCeremony.body.csrf)).status, 200);
  assert.match(deliveredCode, /^\d{8}$/);
  const finishedInvitation = await apiCall(bob, `/api/v1/onboarding/invitation/${attemptId}/complete`,
    { capability, code: deliveredCode }, inviteCeremony.body.csrf);
  assert.equal(finishedInvitation.status, 200);
  assert.equal(finishedInvitation.body.accountId, invitedAccountId);
  assert.equal((await createTenantScopedPool(runtimePool, bob.id).query('SELECT count(*)::int n FROM vaults.accounts')).rows[0].n, 2);
  const ownerKey = randomBytes(32);
  const carol = await reserveCloudTenant(admin, { region: 'asia', host: 'carol.asia.example.com' });
  const dave = await reserveCloudTenant(admin, { region: 'asia', host: 'dave.asia.example.com' });
  for (const tenant of [carol, dave]) await linkCloudControlOwner(admin, { region: 'asia', host: tenant.host,
    ownerIdentityId: randomUUID(), ownerEmail: `admin-${tenant.host.split('.')[0]}@example.com` });
  for (const tenant of [carol, dave]) await prepareCloudTenant(admin, { region: 'asia', host: tenant.host, setupBytes: Buffer.alloc(96) });
  const carolToken = await issueCloudBootstrapToken(admin, { region: 'asia', host: carol.host, tokenKey: ownerKey });
  const daveToken = await issueCloudBootstrapToken(admin, { region: 'asia', host: dave.host, tokenKey: ownerKey });
  assert.notEqual(carolToken.token, daveToken.token);
  const enrollment = await createInternalCloudEnrollmentBoundary({ pool: runtimePool, region: 'asia',
    handle: createInternalCloudEnrollmentHandlers({ tokenKey: ownerKey, bridge: {
      server_public_key: () => Buffer.alloc(32), server_registration_start: () => Buffer.alloc(64),
      server_registration_finish: upload => upload
    } }) });
  const enrollmentCall = async (tenant, path, value, csrf) => {
    const headers = { host: tenant.host, origin: `https://${tenant.host}` };
    if (value) { headers['content-type'] = 'application/json'; headers['x-127v-csrf'] = csrf; headers.cookie = `__Host-127v-ceremony=${csrf}`; }
    const req = Object.assign(Readable.from(value ? [Buffer.from(JSON.stringify(value))] : []), {
      method: value ? 'POST' : 'GET', url: path, rawHeaders: ['Host', tenant.host], headers,
      socket: { encrypted: true, servername: tenant.host, remoteAddress: '127.0.0.1' }
    });
    let status, body;
    const res = { writeHead(code) { status = code; }, end(data) { body = JSON.parse(data); } };
    await enrollment(req, res);
    return { status, body };
  };
  await assert.rejects(enrollmentCall(carol, '/api/v1/devices'), /enrollment route is unavailable/);
  const carolCeremony = await enrollmentCall(carol, '/api/v1/ceremony');
  assert.equal(carolCeremony.status, 200);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicBytes = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const accountId = randomUUID(), deviceId = randomUUID();
  const registrationStarted = await enrollmentCall(carol, '/api/v1/onboarding/register', {
    accountId, deviceId, request: Buffer.alloc(32).toString('base64url')
  }, carolCeremony.body.csrf);
  assert.equal(registrationStarted.status, 200);
  const candidate = { accountId, deviceId, username: 'carol1', displayName: 'Carol', email: 'carol@example.com',
    signingPublicKey: publicBytes.toString('base64url'), opaqueUpload: Buffer.alloc(192).toString('base64url'),
    wrappedRootDescriptor: Buffer.alloc(8).toString('base64url'), wrappedRootEnvelope: Buffer.alloc(16).toString('base64url'),
    registrationArtifact: registrationStarted.body.registrationArtifact };
  candidate.activationSignature = sign(null, registrationActivationBytes({ ...candidate, opaqueRecord: candidate.opaqueUpload },
    Buffer.from(candidate.opaqueUpload, 'base64url')), privateKey).toString('base64url');
  const wrongHost = await enrollmentCall(dave, '/api/v1/onboarding/register', { token: carolToken.token, candidate }, carolCeremony.body.csrf);
  assert.equal(wrongHost.status, 400);
  const owner = await enrollmentCall(carol, '/api/v1/onboarding/register', { token: carolToken.token, candidate }, carolCeremony.body.csrf);
  assert.equal(owner.status, 200);
  assert.equal(owner.body.accountId, accountId);
  assert.equal((await activateCloudTenant(admin, { region: 'asia', host: carol.host })).state, 'active');
  await assert.rejects(enrollmentCall(carol, '/api/v1/ceremony'), /Unknown or inactive tenant/);
  assert.equal((await admin.query('SELECT state FROM cloud.tenants WHERE id=$1', [dave.id])).rows[0].state, 'prepared');
  await admin.query('BEGIN');
  await admin.query('CREATE TABLE vaults.unscoped_cloud_probe(id integer)');
  await assert.rejects(admin.query('SELECT cloud.verify_rls()'), /policy inventory is incomplete/);
  await admin.query('ROLLBACK');
  await admin.query('BEGIN');
  await admin.query('GRANT pg_read_all_data TO vaults_cloud_runtime');
  await assert.rejects(verifyCloudDatabase(admin, 'asia'), /Unsafe regional Cloud runtime role/);
  await admin.query('ROLLBACK');
  console.log(JSON.stringify({ ok: true, isolatedTenants: 4, ownerEnrolled: true,
    invitedUserEnrolled: true, runtimeRole: 'no-login', selfHostedServerRejected: true }));
} catch (error) {
  if (started) try { console.error(run('logs', '--tail', '25', name)); } catch { /* unavailable */ }
  throw error;
} finally {
  if (runtimePool) await runtimePool.end().catch(() => {});
  if (admin) await admin.end().catch(() => {});
  if (started) try { run('rm', '-f', name); } catch { /* already removed */ }
}

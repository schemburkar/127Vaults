// Disposable PostgreSQL acceptance for the internal Cloud database boundary.
// Run explicitly with VAULTS_INTERNAL_CLOUD_LIVE_TEST=1; never targets a named
// installation or an existing volume.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createCipheriv, createHash, createHmac, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { activateCloudTenant, ensureCloudRuntimeLogin, issueCloudBootstrapToken, linkCloudControlOwner, prepareCloudTenant, reserveCloudTenant, verifyCloudDatabase } from '../../../apps/server/internal-cloud/operator.mjs';
import { createCloudManagementHandler, createCloudCustomerDirectoryHandler } from '../../../apps/server/internal-cloud/management.mjs';
import { cloudLandingHost } from '../../../apps/server/internal-cloud/landing.mjs';
const cloudOrigin = `https://${cloudLandingHost}`;
const tenantRequest = (slug, path, headers = {}) => ({
  url: `/t/${slug}${path}`, rawHeaders: ['Host', cloudLandingHost],
  headers: { host: cloudLandingHost, origin: cloudOrigin, ...headers },
  socket: { encrypted: true, servername: cloudLandingHost, remoteAddress: '127.0.0.1' }
});
import { cloudInvitationMailer } from '../../../apps/server/internal-cloud/invitation-mailer.mjs';
import { requireSchema } from '../../../apps/server/src/schema.mjs';
import { createTenantScopedPool, verifyCloudRuntimeRole } from '../../../apps/server/internal-cloud/scoped-pool.mjs';
import { createInternalCloudEnrollmentBoundary, createInternalCloudRequestBoundary } from '../../../apps/server/internal-cloud/request-boundary.mjs';
import { PgAuthStore } from '../../../apps/server/src/auth-pg.mjs';
import { createInternalCloudEnrollmentHandlers, createInternalCloudTenantHandlers } from '../../../apps/server/internal-cloud/tenant-handlers.mjs';
import { registrationActivationBytes } from '../../../apps/server/src/opaque-adapter.mjs';
import { createCloudHttpsServer } from '../../../apps/server/internal-cloud/serve.mjs';
import { verifyCheckpoint } from '../../../packages/sync/src/index.mjs';
import { localCloudVaultWorker } from '../support/cloud-vault-worker-fixture.mjs';
import { adminHost, customerHost, directoryHost, localCloudAdmin, localCloudManage, localOperator, managementHost } from '../support/cloud-admin-browser-fixture.mjs';
const pg = createRequire(new URL('../../../apps/server/package.json', import.meta.url))('pg');

if (process.env.VAULTS_INTERNAL_CLOUD_LIVE_TEST !== '1') throw new Error('Explicit disposable-test opt-in required.');
const browserEnabled = Boolean(process.env.VAULTS_PLAYWRIGHT_MODULE && process.env.VAULTS_BROWSER_EXECUTABLE);
const workerEnabled = process.env.VAULTS_CLOUD_REHEARSE_WORKER === '1';
if (workerEnabled && !browserEnabled) throw Error('The Cloud Worker rehearsal requires the browser fixture.');
if (!browserEnabled && (process.env.VAULTS_PLAYWRIGHT_MODULE || process.env.VAULTS_BROWSER_EXECUTABLE)) {
  throw new Error('Provide both VAULTS_PLAYWRIGHT_MODULE and VAULTS_BROWSER_EXECUTABLE for the browser rehearsal.');
}
const name = `vaults-cloud-test-${randomBytes(5).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const run = (...args) => execFileSync('podman', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trim();
let started = false;
let admin;
let runtimePool;
let mailCapture;
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
  const runtimeUser = 'vaults_cloud_login_test';
  const runtimePassword = randomBytes(32).toString('hex');
  const deployDir = mkdtempSync(join(tmpdir(), 'vaults-cloud-deploy-'));
  const operatorFile = join(deployDir, 'operator-password');
  const runtimeFile = join(deployDir, 'runtime-password');
  try {
    writeFileSync(operatorFile, password, { mode: 0o600 });
    writeFileSync(runtimeFile, runtimePassword, { mode: 0o600 });
    const deploy = () => JSON.parse(execFileSync(process.execPath,
      [fileURLToPath(new URL('../../../apps/server/internal-cloud/cli.mjs', import.meta.url)), 'deploy'],
      { encoding: 'utf8', env: { ...process.env, VAULTS_INTERNAL_CLOUD_OPERATIONS: '1', VAULTS_CLOUD_REGION: 'global',
        VAULTS_DATABASE_HOST: '127.0.0.1', VAULTS_DATABASE_PORT: String(port), VAULTS_DATABASE_NAME: 'vaults_cloud_test',
        VAULTS_DATABASE_USER: 'cloud_operator', VAULTS_DATABASE_PASSWORD_FILE: operatorFile,
        VAULTS_CLOUD_RUNTIME_DATABASE_USER: runtimeUser, VAULTS_CLOUD_RUNTIME_DATABASE_PASSWORD_FILE: runtimeFile } }));
    const first = deploy();
    assert.equal(first.initialized, true);
    assert.equal(first.created, true);
    const second = deploy();
    assert.equal(second.initialized, false);
    assert.equal(second.created, false);
  } finally {
    unlinkSync(operatorFile);
    unlinkSync(runtimeFile);
    rmdirSync(deployDir);
  }
  await verifyCloudDatabase(admin, 'global');
  await assert.rejects(requireSchema(admin), /Cloud database cannot be served/);
  const alice = await reserveCloudTenant(admin, { region: 'global', slug: 'alice', maxActiveUsers: 1 });
  const bob = await reserveCloudTenant(admin, { region: 'global', slug: 'bob', maxActiveUsers: 2 });
  assert.notEqual(alice.id, bob.id);
  assert.equal((await reserveCloudTenant(admin, { region: 'global', slug: alice.slug, maxActiveUsers: 1 })).id, alice.id);
  await assert.rejects(reserveCloudTenant(admin, { region: 'global', slug: alice.slug, maxActiveUsers: 2 }), /conflicts/);
  await assert.rejects(activateCloudTenant(admin, { region: 'global', slug: alice.slug }), /not prepared/);
  await prepareCloudTenant(admin, { region: 'global', slug: alice.slug, setupBytes: Buffer.alloc(96) });
  await prepareCloudTenant(admin, { region: 'global', slug: bob.slug, setupBytes: Buffer.alloc(96) });
  assert.equal((await prepareCloudTenant(admin, { region: 'global', slug: alice.slug, setupBytes: Buffer.alloc(96) })).reused, true);
  await assert.rejects(activateCloudTenant(admin, { region: 'global', slug: alice.slug }), /control owner is required/);
  const controlOwners = new Map();
  for (const tenant of [alice, bob]) {
    const ownerIdentityId = randomUUID(), ownerEmail = `admin-${tenant.slug}@example.com`;
    controlOwners.set(tenant.id, { ownerIdentityId, ownerEmail });
    await linkCloudControlOwner(admin, { region: 'global', slug: tenant.slug, ownerIdentityId, ownerEmail });
  }
  assert.equal((await linkCloudControlOwner(admin, { region: 'global', slug: alice.slug, ...controlOwners.get(alice.id) })).reused, true);
  await assert.rejects(linkCloudControlOwner(admin, { region: 'global', slug: alice.slug,
    ownerIdentityId: randomUUID(), ownerEmail: 'other@example.com' }), /another identity/);
  assert.equal((await admin.query('SELECT count(*)::int n FROM vaults.accounts')).rows[0].n, 0);
  await assert.rejects(activateCloudTenant(admin, { region: 'global', slug: alice.slug }), /owner enrollment is incomplete/);
  await admin.query(`INSERT INTO vaults.accounts(tenant_id,id,username,display_name,email,server_role,enrollment_state)
    VALUES($1,$1,'alice1','Alice','alice@example.com','owner','active'),($2,$2,'bobby1','Bob','bob@example.com','owner','active')`, [alice.id, bob.id]);
  await admin.query(`INSERT INTO vaults.authentication_credentials(tenant_id,account_id,opaque_record,wrapped_root_descriptor,wrapped_root_envelope)
    VALUES($1,$1,$3,$4,$4),($2,$2,$3,$4,$4)`, [alice.id, bob.id, Buffer.alloc(192), Buffer.alloc(1)]);
  await admin.query(`INSERT INTO vaults.bootstrap_tokens(tenant_id,token_digest,expires_at,consumed_at)
    VALUES($1,$3,now()+interval '1 hour',now()),($2,$3,now()+interval '1 hour',now())`, [alice.id, bob.id, Buffer.alloc(32)]);
  await admin.query(`INSERT INTO vaults.devices(tenant_id,account_id,id,signing_public_key,credential_epoch,credential_epoch_seen)
    VALUES($1,$1,$2,$3,1,1)`, [alice.id, randomUUID(), Buffer.alloc(32)]);
  assert.equal((await activateCloudTenant(admin, { region: 'global', slug: alice.slug })).state, 'active');
  assert.equal((await activateCloudTenant(admin, { region: 'global', slug: alice.slug })).reused, true);
  runtimePool = new pg.Pool({ host: '127.0.0.1', port, user: runtimeUser, password: runtimePassword,
    database: 'vaults_cloud_test', max: 1 });
  await verifyCloudRuntimeRole(runtimePool);
  const readSeatLimit = async (pool, tenantId) => (await pool.query('SELECT cloud.enrollment_seat_limit($1) AS seat_limit', [tenantId])).rows[0].seat_limit;
  assert.equal(await readSeatLimit(runtimePool, alice.id), null);
  assert.equal(await readSeatLimit(createTenantScopedPool(runtimePool, alice.id), bob.id), null);
  assert.equal(await readSeatLimit(createTenantScopedPool(runtimePool, alice.id), alice.id), 1);
  assert.equal((await runtimePool.query('SELECT count(*)::int AS n FROM vaults.accounts')).rows[0].n, 0);
  const scopedConnection = await createTenantScopedPool(runtimePool, alice.id).connect();
  let backend;
  try {
    await scopedConnection.query('BEGIN');
    await scopedConnection.query('SELECT pg_advisory_xact_lock(127, 99)');
    const { rows: [state] } = await scopedConnection.query(`SELECT pg_backend_pid() AS pid,
      current_setting('vaults.tenant_id', true) AS tenant,
      EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()) AS locked`);
    assert.equal(state.tenant, alice.id);
    assert.equal(state.locked, true);
    backend = state.pid;
    await scopedConnection.query('COMMIT');
    await scopedConnection.query('BEGIN');
    assert.equal((await scopedConnection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, backend);
    await assert.rejects(scopedConnection.query('SELECT 1/0'), /division by zero/);
    await scopedConnection.query('ROLLBACK');
  } finally { scopedConnection.release(); }
  const { rows: [cleanConnection] } = await runtimePool.query(`SELECT pg_backend_pid() AS pid,
    NULLIF(current_setting('vaults.tenant_id', true), '') AS tenant,
    EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()) AS locked`);
  assert.deepEqual(cleanConnection, { pid: backend, tenant: null, locked: false });
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
  assert.equal((await admin.query('SELECT cloud.resolve_tenant($1,$2) AS id', [bob.slug, 'global'])).rows[0].id, null);
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
  await activateCloudTenant(admin, { region: 'global', slug: alice.slug });
  await admin.query('SET ROLE vaults_cloud_runtime');
  assert.equal((await admin.query('SELECT cloud.resolve_tenant($1,$2) AS id', [alice.slug, 'global'])).rows[0].id, alice.id);
  assert.equal((await admin.query('SELECT cloud.resolve_tenant($1,$2) AS id', [alice.slug, 'europe'])).rows[0].id, null);
  await admin.query('RESET ROLE');
  await admin.query('ROLLBACK');
  await admin.query("UPDATE cloud.tenants SET state='active',activated_at=now() WHERE id=$1", [alice.id]);
  const boundary = await createInternalCloudRequestBoundary({ pool: runtimePool, region: 'global',
    handle: async (_req, _res, context) => {
      const rows = (await context.pool.query('SELECT tenant_id FROM vaults.accounts')).rows;
      assert.deepEqual(rows.map(x => x.tenant_id), [alice.id]);
      return context.tenant.id;
    } });
  assert.equal(await boundary(tenantRequest(alice.slug, '/api/v1/devices'), {}), alice.id);
  await assert.rejects(boundary(tenantRequest(bob.slug, '/api/v1/devices'), {}));
  await activateCloudTenant(admin, { region: 'global', slug: bob.slug });
  mailCapture = mkdtempSync(join(tmpdir(), 'vaults-cloud-mail-'));
  const mailer = await cloudInvitationMailer({ VAULTS_CLOUD_INVITATION_MAIL: 'capture', VAULTS_CLOUD_MAIL_CAPTURE_DIR: mailCapture });
  const api = await createInternalCloudRequestBoundary({ pool: runtimePool, region: 'global',
    handle: createInternalCloudTenantHandlers({ bridge: { server_public_key: () => Buffer.alloc(32),
      server_registration_start: () => Buffer.alloc(64), server_registration_finish: upload => upload },
      tokenKey, checkpointPrivateKey: {}, checkpointPublicKey: 'test-key',
      mailer }) });
  const discover = async tenant => {
    let status, body;
    await api({ method: 'GET', ...tenantRequest(tenant.slug, '/api/v1/cloud/discovery') },
    { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } });
    return { status, body };
  };
  for (const tenant of [alice, bob]) {
    const result = await discover(tenant);
    assert.equal(result.status, 200);
    assert.equal(result.body.tenantId, tenant.id);
    assert.equal(result.body.canonicalOrigin, cloudOrigin);
    assert.equal(result.body.canonicalUrl, `${cloudOrigin}/t/${tenant.slug}/`);
    assert.equal(result.body.region, 'global');
  }
  const callDevices = async (tenantHost) => {
    let status, body;
    const req = { method: 'GET', ...tenantRequest(tenantHost, '/api/v1/devices',
      { cookie: `__Host-127v-session=${sessionToken.toString('base64url')}` }) };
    const res = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
    await api(req, res);
    return { status, body };
  };
  const ownDevices = await callDevices(bob.slug);
  assert.equal(ownDevices.status, 200);
  assert.deepEqual(ownDevices.body.devices.map(x => x.deviceId), [bobDevice]);
  assert.deepEqual(await callDevices(alice.slug), { status: 401, body: { error: 'authentication_required' } });
  const callInvite = async (tenantHost, email = 'new@example.com') => {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ emails: [email], expiresInHours: 24 }))]), {
      method: 'POST', ...tenantRequest(tenantHost, '/api/v1/invitations', { 'content-type': 'application/json',
        'x-127v-csrf': csrf.toString('base64url'), cookie: `__Host-127v-session=${sessionToken.toString('base64url')}` })
    });
    let status, body;
    const res = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
    await api(req, res);
    return { status, body };
  };
  const invited = await callInvite(bob.slug);
  assert.equal(invited.status, 200);
  assert.deepEqual(await callInvite(bob.slug), { status: 409, body: { error: 'seat_limit_reached' } });
  assert.equal((await createTenantScopedPool(runtimePool, bob.id).query('SELECT count(*)::int n FROM vaults.invitation_records')).rows[0].n, 1);
  assert.deepEqual(await callInvite(alice.slug), { status: 401, body: { error: 'authentication_required' } });
  const apiCall = async (tenant, path, value, csrfValue) => {
    const headers = {};
    if (value) { headers['content-type'] = 'application/json'; headers['x-127v-csrf'] = csrfValue; headers.cookie = `__Host-127v-ceremony=${csrfValue}`; }
    const req = Object.assign(Readable.from(value ? [Buffer.from(JSON.stringify(value))] : []), {
      method: value ? 'POST' : 'GET', ...tenantRequest(tenant.slug, path, headers)
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
    accountId: invitedAccountId, deviceId: invitedDeviceId, request: Buffer.alloc(32).toString('base64url'),token:invited.body.token,email:'new@example.com'
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
  const [capture] = readdirSync(mailCapture);
  const { to, code: deliveredCode } = JSON.parse(readFileSync(join(mailCapture, capture), 'utf8'));
  assert.equal(to, 'new@example.com');
  assert.match(deliveredCode, /^\d{8}$/);
  const finishedInvitation = await apiCall(bob, `/api/v1/onboarding/invitation/${attemptId}/complete`,
    { capability, code: deliveredCode }, inviteCeremony.body.csrf);
  assert.equal(finishedInvitation.status, 200);
  assert.equal(finishedInvitation.body.accountId, invitedAccountId);
  const ownerApi = async (path, payload, tenantHost = bob.slug) => {
    const req = Object.assign(Readable.from(payload ? [Buffer.from(JSON.stringify(payload))] : []), {
      method: payload ? 'POST' : 'GET', ...tenantRequest(tenantHost, path, { 'content-type': 'application/json',
        'x-127v-csrf': csrf.toString('base64url'), cookie: `__Host-127v-session=${sessionToken.toString('base64url')}` })
    });
    let status, body;
    await api(req, { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } });
    return { status, body };
  };
  const familyPath = '/api/v1/cloud/family';
  const roster = await ownerApi(familyPath);
  assert.equal(roster.status, 200);
  assert.equal(roster.body.activeUsers, 2);
  assert.equal(roster.body.members.find(member => member.id === invitedAccountId).role, 'user');
  assert.equal((await ownerApi('/api/v1/license')).body.scope, 'cloud-tenant');
  assert.equal((await ownerApi(familyPath, undefined, alice.slug)).status, 401);
  assert.equal((await ownerApi(`${familyPath}/suspend-member`, { targetId: alice.id })).status, 404);
  assert.equal((await ownerApi(`${familyPath}/suspend-member`, { targetId: bob.id })).status, 404);
  const memberToken = randomBytes(32);
  const memberDigest = createHmac('sha256', tokenKey).update('session').update('\0').update(memberToken).digest();
  await admin.query(`INSERT INTO vaults.sessions(tenant_id,token_digest,account_id,device_id,credential_epoch,csrf_digest,csrf_cipher,expires_at)
    VALUES($1,$2,$3,$4,1,$5,$6,now()+interval '1 hour')`, [bob.id, memberDigest, invitedAccountId, invitedDeviceId, csrfDigest, csrfCipher]);
  assert.equal((await bobAuth.authenticate({ token: memberToken, now: new Date() })).role, 'user');
  assert.deepEqual(await ownerApi(`${familyPath}/suspend-member`, { targetId: invitedAccountId }), { status: 200, body: { suspended: true } });
  await assert.rejects(bobAuth.authenticate({ token: memberToken, now: new Date() }));
  const replacement = await callInvite(bob.slug);
  assert.equal(replacement.status, 400); // The original recipient already has an account.
  const nextInvitation = await callInvite(bob.slug, 'another@example.com');
  assert.equal(nextInvitation.status, 200);
  assert.equal((await ownerApi(`${familyPath}/reactivate-member`, { targetId: invitedAccountId })).status, 409);
  assert.equal((await ownerApi(`${familyPath}/revoke-invitation`, { targetId: nextInvitation.body.invitationId })).status, 200);
  assert.deepEqual(await ownerApi(`${familyPath}/reactivate-member`, { targetId: invitedAccountId }), { status: 200, body: { suspended: false } });
  await assert.rejects(bobAuth.authenticate({ token: memberToken, now: new Date() }));
  assert.equal((await createTenantScopedPool(runtimePool, bob.id).query('SELECT count(*)::int n FROM vaults.accounts')).rows[0].n, 2);
  const ownerKey = randomBytes(32);
  const carol = await reserveCloudTenant(admin, { region: 'global', slug: 'carol', maxActiveUsers: 1 });
  const dave = await reserveCloudTenant(admin, { region: 'global', slug: 'dave', maxActiveUsers: 1 });
  for (const tenant of [carol, dave]) await linkCloudControlOwner(admin, { region: 'global', slug: tenant.slug,
    ownerIdentityId: randomUUID(), ownerEmail: `admin-${tenant.slug}@example.com` });
  for (const tenant of [carol, dave]) await prepareCloudTenant(admin, { region: 'global', slug: tenant.slug, setupBytes: Buffer.alloc(96) });
  const carolToken = await issueCloudBootstrapToken(admin, { region: 'global', slug: carol.slug, tokenKey: ownerKey });
  const daveToken = await issueCloudBootstrapToken(admin, { region: 'global', slug: dave.slug, tokenKey: ownerKey });
  assert.notEqual(carolToken.token, daveToken.token);
  const enrollment = await createInternalCloudEnrollmentBoundary({ pool: runtimePool, region: 'global',
    handle: createInternalCloudEnrollmentHandlers({ tokenKey: ownerKey, bridge: {
      server_public_key: () => Buffer.alloc(32), server_registration_start: () => Buffer.alloc(64),
      server_registration_finish: upload => upload
    } }) });
  const enrollmentCall = async (tenant, path, value, csrf) => {
    const headers = {};
    if (value) { headers['content-type'] = 'application/json'; headers['x-127v-csrf'] = csrf; headers.cookie = `__Host-127v-ceremony=${csrf}`; }
    const req = Object.assign(Readable.from(value ? [Buffer.from(JSON.stringify(value))] : []), {
      method: value ? 'POST' : 'GET', ...tenantRequest(tenant.slug, path, headers)
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
    accountId, deviceId, request: Buffer.alloc(32).toString('base64url'),token:carolToken.token,email:null
  }, carolCeremony.body.csrf);
  assert.equal(registrationStarted.status, 200);
  const candidate = { accountId, deviceId, username: 'carol1', displayName: 'Carol', email: 'carol@example.com',
    signingPublicKey: publicBytes.toString('base64url'), opaqueUpload: Buffer.alloc(192).toString('base64url'),
    wrappedRootDescriptor: Buffer.alloc(8).toString('base64url'), wrappedRootEnvelope: Buffer.alloc(16).toString('base64url'),
    registrationArtifact: registrationStarted.body.registrationArtifact };
  candidate.activationSignature = sign(null, registrationActivationBytes({ ...candidate, opaqueRecord: candidate.opaqueUpload },
    Buffer.from(candidate.opaqueUpload, 'base64url')), privateKey).toString('base64url');
  const wrongCeremony = await enrollmentCall(dave, '/api/v1/onboarding/register', { token: carolToken.token, candidate }, carolCeremony.body.csrf);
  assert.equal(wrongCeremony.status, 403);
  const daveCeremony = await enrollmentCall(dave, '/api/v1/ceremony');
  const wrongTenant = await enrollmentCall(dave, '/api/v1/onboarding/register', { token: carolToken.token, candidate }, daveCeremony.body.csrf);
  assert.equal(wrongTenant.status, 400);
  const owner = await enrollmentCall(carol, '/api/v1/onboarding/register', { token: carolToken.token, candidate }, carolCeremony.body.csrf);
  assert.equal(owner.status, 200);
  assert.equal(owner.body.accountId, accountId);
  assert.equal((await activateCloudTenant(admin, { region: 'global', slug: carol.slug })).state, 'active');
  await assert.rejects(enrollmentCall(carol, '/api/v1/ceremony'), /Unknown or inactive tenant/);
  assert.equal((await admin.query('SELECT state FROM cloud.tenants WHERE id=$1', [dave.id])).rows[0].state, 'prepared');
  const manager = { user: 'vaults_cloud_manager_test', password: randomBytes(32).toString('hex') };
  await ensureCloudRuntimeLogin(admin, manager, { management: true });
  const managementPool = new pg.Pool({ ...manager, host: '127.0.0.1', port, database: 'vaults_cloud_test', max: 1 });
  try {
    const serviceToken = randomBytes(32).toString('hex');
    const customerDirectoryToken = randomBytes(32).toString('hex');
    const manage = await createCloudManagementHandler({ pool: managementPool, serviceToken, tokenKey: ownerKey,
      createOpaqueSetup: () => Buffer.alloc(96) });
    const directory = createCloudCustomerDirectoryHandler({ pool: managementPool, customerDirectoryToken });
    const invoke = async (command, input, authorization = `Bearer ${serviceToken}`, expectedStatus = 200, handler = manage) => {
      const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]), {
        url: `/internal/cloud/v1/${command}`, method: 'POST', socket: { encrypted: true },
        headers: { authorization, 'x-127v-operator': 'pilot-operator', 'content-type': 'application/json' }
      });
      let status, body;
      await handler(req, { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } });
      assert.equal(status, expectedStatus, JSON.stringify(body));
      return body;
    };
    await invoke('list', {}, 'Bearer invalid', 401);
    const slug = 'eve';
    const provisioned = await invoke('provision', { slug, maxActiveUsers: 3, ownerIdentityId: randomUUID(), ownerEmail: 'eve@example.com' });
    assert.equal(provisioned.state, 'prepared');
    const directoryBearer = `Bearer ${customerDirectoryToken}`;
    await invoke('customer-tenants', { email: 'eve@example.com' }, `Bearer ${serviceToken}`, 401, directory);
    await invoke('customer-tenants', { email: 'eve@example.com' }, directoryBearer, 404);
    await invoke('set-seats', { slug, maxActiveUsers: 4 }, directoryBearer, 401);
    await invoke('set-seats', { slug, maxActiveUsers: 4 }, directoryBearer, 404, directory);
    assert.deepEqual(await invoke('customer-tenants', { email: 'eve@example.com' }, directoryBearer, 200, directory),
      { tenants: [{ slug, state: 'prepared', maxActiveUsers: 3, canonicalUrl: `${cloudOrigin}/t/${slug}/` }] });
    assert.deepEqual(await invoke('customer-tenants', { email: 'unrelated@example.com' }, directoryBearer, 200, directory), { tenants: [] });
    const firstLink = (await invoke('issue-setup', { slug })).setupUrl;
    assert.notEqual((await invoke('issue-setup', { slug })).setupUrl, firstLink);
    assert.equal((await invoke('list', {})).find(tenant => tenant.slug === slug).maxActiveUsers, 3);
    assert.equal((await invoke('activate', { slug: carol.slug })).state, 'active');
    assert.equal((await invoke('set-seats', { slug: alice.slug, maxActiveUsers: 4 })).maxActiveUsers, 4);
    assert.equal((await invoke('suspend', { slug: alice.slug })).state, 'suspended');
    assert.equal((await invoke('resume', { slug: alice.slug })).state, 'active');
    await assert.rejects(managementPool.query('SELECT setup_bytes FROM vaults.opaque_server_setup'), /permission denied/);
    await assert.rejects(runtimePool.query('SELECT actor FROM cloud.operator_audit'), /permission denied/);
    assert.deepEqual((await admin.query('SELECT action FROM cloud.operator_audit WHERE tenant_id=$1 ORDER BY action', [provisioned.id])).rows,
      [{ action: 'issue-setup' }, { action: 'issue-setup' }, { action: 'provision' }]);
  } finally {
    await managementPool.end();
  }
  run('exec', name, 'openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
    '-days', '1', '-subj', `/CN=${cloudLandingHost}`, '-addext', `subjectAltName=DNS:${cloudLandingHost},DNS:unknown.asia.example.com,DNS:${adminHost},DNS:${managementHost},DNS:${customerHost},DNS:${directoryHost}`,
    '-keyout', '/tmp/cloud-test.key', '-out', '/tmp/cloud-test.crt');
  const ca = run('exec', name, 'cat', '/tmp/cloud-test.crt');
  const httpsServer = await createCloudHttpsServer({ pool: runtimePool,
    tls: { cert: ca, key: run('exec', name, 'cat', '/tmp/cloud-test.key') },
    bridge: { server_public_key: () => Buffer.alloc(32) }, tokenKey, checkpointPrivateKey: privateKey });
  try {
    httpsServer.listen(0, '127.0.0.1');
    await once(httpsServer, 'listening');
    const status = (host, path, servername = host) => new Promise((resolve, reject) => {
      const req = httpsRequest({ hostname: '127.0.0.1', port: httpsServer.address().port, path,
        servername, headers: { host }, ca, agent: false }, res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(await status(cloudLandingHost, `/t/${alice.slug}/api/v1/cloud/discovery`), 200);
    assert.equal(await status(cloudLandingHost, `/t/${alice.slug}/api/v1/setup`), 200);
    assert.equal(await status(cloudLandingHost, `/t/${dave.slug}/api/v1/ceremony`), 200);
    assert.equal(await status(cloudLandingHost, `/t/${dave.slug}/api/v1/setup`), 200);
    assert.equal(await status(cloudLandingHost, `/t/${dave.slug}/api/v1/cloud/discovery`), 404);
    assert.equal(await status(cloudLandingHost, '/t/unknown/api/v1/ceremony'), 404);
    assert.equal(await status(cloudLandingHost, `/t/${alice.slug}/api/v1/ceremony`, 'unknown.asia.example.com'), 400);
    assert.equal(await status(cloudLandingHost, '/'), 200);
    assert.equal(await status(cloudLandingHost, '/landing.css'), 200);
    assert.equal(await status(cloudLandingHost, '/healthz'), 200);
    assert.equal(await status(cloudLandingHost, '/api/v1/setup'), 404);
    assert.equal(await status(cloudLandingHost, '/', 'unknown.asia.example.com'), 400);
    await assert.rejects(reserveCloudTenant(admin, { region: 'global', slug: cloudLandingHost, maxActiveUsers: 1 }), /Invalid Cloud tenant slug/);
  } finally {
    await new Promise(resolve => httpsServer.close(resolve));
  }
  if (browserEnabled) {
    const slugs = ['family-one', 'family-two'];
    const load = createRequire(import.meta.url);
    const { chromium } = load(process.env.VAULTS_PLAYWRIGHT_MODULE);
    const { ExperimentalOpaqueBridge: bridge } = load('../../../apps/server/wasm-auth/vaults_browser_fixture.cjs');
    const tls = { cert: ca, key: run('exec', name, 'cat', '/tmp/cloud-test.key') };
    const browserManagementPool = new pg.Pool({ ...manager, host: '127.0.0.1', port, database: 'vaults_cloud_test', max: 1 });
    const worker = workerEnabled ? localCloudVaultWorker({ tls, tokenKey, checkpointPrivateKey: privateKey, mailer,
      databaseUrl: `postgres://${runtimeUser}:${runtimePassword}@127.0.0.1:${port}/vaults_cloud_test` }) : null;
    const realServer = worker?.server ?? await createCloudHttpsServer({ pool: runtimePool, tls,
      bridge, tokenKey, checkpointPrivateKey: privateKey, mailer, onError: error => console.error('Browser fixture server error', error.code ?? error.name) });
    let browser, operatorFixture, customerFixture;
    try {
      const coldAt = performance.now();
      realServer.listen(0, '127.0.0.1');
      await once(realServer, 'listening');
      const readyStatus = worker ? (await worker.dispatch(`${cloudOrigin}/healthz`)).status :
        await new Promise((resolve, reject) => {
          const probe = httpsRequest({ hostname: '127.0.0.1', port: realServer.address().port,
            servername: cloudLandingHost, headers: { Host: cloudLandingHost }, ca, path: '/healthz' },
          response => { response.resume(); resolve(response.statusCode); });
          probe.once('error', reject);
          probe.end();
        });
      assert.equal(readyStatus, 200);
      const timings = { firstReadyMs: Math.round(performance.now() - coldAt), unlockMs: [], signedWriteMs: [], readBackMs: [] };
      if (worker) {
        assert.equal((await worker.dispatch('https://wrong.example.com/')).status, 404);
        assert.equal((await worker.dispatch(`${cloudOrigin}/t/alice%2Fbob/`)).status, 404);
        assert.equal((await worker.dispatch(`${cloudOrigin}/`)).status, 200);
        const manifest = await worker.dispatch(`${cloudOrigin}/t/alice/manifest.webmanifest`);
        assert.equal(manifest.status, 200);
        assert.equal((await manifest.json()).scope, '/t/alice/');
      }
      operatorFixture = await localCloudAdmin({ tls, pool: browserManagementPool, tokenKey, bridge });
      customerFixture = await localCloudManage({ tls, pool: browserManagementPool });
      const directoryProbe = await customerFixture.start('eve@example.com');
      assert.equal(directoryProbe.status, 202);
      assert.ok(await customerFixture.manualMail('eve@example.com'), customerFixture.directoryResult());
      const routes = [...[cloudLandingHost].map(host => `MAP ${host} 127.0.0.1:${realServer.address().port}`),
        `MAP ${adminHost} 127.0.0.1:${operatorFixture.port}`,
        `MAP ${customerHost} 127.0.0.1:${customerFixture.port}`];
      const fixtureSpki = createHash('sha256').update(new X509Certificate(ca).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
      browser = await chromium.launch({ executablePath: process.env.VAULTS_BROWSER_EXECUTABLE, args: ['--no-proxy-server',
        `--ignore-certificate-errors-spki-list=${fixtureSpki}`,
        `--host-resolver-rules=${routes.join(', ')}`] });
      const pageOptions = { ignoreHTTPSErrors: true, serviceWorkers: 'block' };
      const portal = await browser.newPage(pageOptions);
      const portalUrl = `${operatorFixture.origin}/cloud-tenants`;
      await portal.goto(portalUrl);
      await portal.getByRole('status').filter({ hasText: 'authorized Cloud operator' }).waitFor();
      await portal.route('**/cloud-tenants/api/**', route => route.continue({ headers: { ...route.request().headers(),
        'cf-access-jwt-assertion': operatorFixture.assertion } }));
      portal.on('dialog', dialog => dialog.accept());
      await portal.reload();
      const password = 'Local synthetic master password only';
      const form = async (page, url, username, email) => {
        const setupResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api/v1/setup'));
        await page.goto(url);
        const state = await setupResponse;
        assert.equal(state.status(), 200, 'Cloud setup status should be reachable on the canonical browser origin');
        assert.equal((await state.json()).ownerRequired, username === 'browserowner');
        await page.locator('#registration-username').fill(username);
        await page.locator('.registration-step[data-registration-step="0"] .registration-next').click();
        await page.locator('#display').fill(username);
        await page.locator('#email').fill(email);
        await page.locator('.registration-step[data-registration-step="1"] .registration-next').click();
        await page.locator('.registration-step[data-registration-step="2"] .registration-next').click();
        await page.locator('#registration-master').fill(password);
        await page.locator('#registration-master-confirm').fill(password);
        await page.locator('#setup').click();
      };
      const unlock = async page => {
        await page.locator('#master').fill(password);
        const startedAt = performance.now();
        const [proof] = await Promise.all([
          page.waitForResponse(response => response.status() === 200 && new URL(response.url()).pathname.endsWith('/device-proof')),
          page.locator('#login').click()
        ]);
        await page.locator('#vault').waitFor({ state: 'visible' });
        timings.unlockMs.push(Math.round(performance.now() - startedAt));
        return (await proof.json()).csrf;
      };
      const members = [];
      const writes = [];
      let liveInvitation;
      for (const [index, slug] of slugs.entries()) {
        const create = portal.locator('#cloud-create');
        await create.locator('[name="slug"]').fill(slug);
        await create.locator('[name="seats"]').fill(worker && index === 0 ? '3' : '2');
        await create.locator('[name="owner"]').fill(randomUUID());
        await create.locator('[name="email"]').fill(`browser-owner-${index}@example.com`);
        await create.getByRole('button', { name: 'Create tenant' }).click();
        const tenant = portal.locator('#cloud-directory section').filter({ has: portal.getByRole('heading', { name: slug, exact: true }) });
        await tenant.getByRole('button', { name: 'Issue or replace setup link' }).click();
        const setupLink = portal.locator('#cloud-setup-link');
        await setupLink.waitFor({ state: 'visible' });
        const setupUrl = await setupLink.inputValue();
        assert.equal(new URL(setupUrl).pathname, `/t/${slug}/`);
        const owner = await browser.newPage(pageOptions);
        await form(owner, setupUrl, 'browserowner', 'browser-owner@example.com');
        await owner.locator('#master').waitFor({ state: 'visible' });
        await portal.getByRole('button', { name: 'Refresh tenants' }).click();
        await tenant.getByRole('button', { name: 'Activate tenant' }).click();
        await tenant.getByRole('button', { name: 'Suspend tenant' }).waitFor();
        await unlock(owner);
        await owner.locator('#settings-toggle').click();
        await owner.locator('#cloud-family-tab').click();
        const email = `browser-member-${index}@example.com`;
        await owner.locator('#cloud-family-email').fill(email);
        await owner.locator('#cloud-family-invite button').click();
        await owner.locator('#cloud-family-url').waitFor({ state: 'visible' });
        const member = await (await browser.newContext(pageOptions)).newPage();
        let registration, signedWrite;
        member.on('request', request => {
          const path = new URL(request.url()).pathname;
          if (request.method() !== 'POST') return;
          if (path.endsWith('/api/v1/onboarding/register') && !registration) registration = request;
          if (/\/vaults\/[^/]+\/items$/.test(path) && !signedWrite) signedWrite = request;
        });
        await form(member, await owner.locator('#cloud-family-url').inputValue(), 'browsermember', email);
        await member.waitForFunction(() => document.querySelector('#setup-status')?.textContent.includes('sent to your invited email'));
        const captured = readdirSync(mailCapture).map(file => JSON.parse(readFileSync(join(mailCapture, file), 'utf8')))
          .find(message => message.to === email);
        assert.ok(captured);
        await member.locator('#cloud-member-code').fill(captured.code);
        await member.locator('#cloud-member-verification button[type="submit"]').click();
        const currentCsrf = await unlock(member);
        await member.locator('#create-vault').click();
        await member.locator('#web-vault-name').fill('Synthetic family vault');
        await member.locator('#web-create-vault-submit').click();
        await member.locator('#web-create-vault-dialog').waitFor({ state: 'hidden' });
        await member.locator('#new-item').click();
        const title = `Synthetic Cloud sync item ${index}`;
        await member.locator('#title').fill(title);
        const writeAt = performance.now();
        await member.locator('#save').click();
        const savedItem = member.locator('#items [data-item-id]').filter({ hasText: title });
        await savedItem.waitFor({ state: 'visible' });
        timings.signedWriteMs.push(Math.round(performance.now() - writeAt));
        const write = signedWrite;
        writes.push({ url: write.url(), body: write.postDataJSON(), csrf: currentCsrf });
        const operation = writes[index].body.signedOperation;
        const checkpointUrl = write.url().replace(/\/items$/, '/checkpoint');
        const checkpointHistory = await member.evaluate(async ({ url, csrf }) => {
          const created = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-127V-CSRF': csrf }, body: '{}' });
          if (!created.ok) throw Error(`Checkpoint generation returned ${created.status}`);
          const history = await fetch(url + '?history=1');
          if (!history.ok) throw Error(`Checkpoint history returned ${history.status}`);
          return (await history.json()).checkpoints;
        }, { url: checkpointUrl, csrf: currentCsrf });
        assert.ok(checkpointHistory.length > 0);
        let previousCheckpoint;
        for (const checkpoint of checkpointHistory) {
          verifyCheckpoint(checkpoint, { tenantId: operation.tenantId, vaultId: operation.vaultId, epoch: operation.epoch,
            publicKey: createPublicKey(privateKey), previousCheckpoint });
          previousCheckpoint = checkpoint;
        }
        await member.reload();
        await member.waitForFunction(() => document.querySelector('#username')?.value === 'browsermember' &&
          document.body.getAttribute('aria-busy') === 'false');
        await member.locator('#login-next').click();
        const readAt = performance.now();
        writes[index].csrf = await unlock(member);
        await savedItem.waitFor({ state: 'visible' });
        timings.readBackMs.push(Math.round(performance.now() - readAt));
        members.push(member);
        if (worker && index === 0) {
          const inviteEmail = 'unused-cloud-invite@example.com';
          const previousLink = await owner.locator('#cloud-family-url').inputValue();
          await owner.locator('#cloud-family-email').fill(inviteEmail);
          await owner.locator('#cloud-family-invite button').click();
          await owner.waitForFunction(previous => {
            const value = document.querySelector('#cloud-family-url')?.value;
            return value && value !== previous;
          }, previousLink);
          const url = new URL(await owner.locator('#cloud-family-url').inputValue());
          liveInvitation = { ...registration.postDataJSON(), email: inviteEmail, accountId: randomUUID(), deviceId: randomUUID(),
            token: url.hash.slice('#memberInvite='.length) };
        }
      }
      for (const [index, member] of members.entries()) {
        assert.equal(await member.locator('#items [data-item-id]').filter({ hasText: `Synthetic Cloud sync item ${1 - index}` }).count(), 0);
      }
      if (worker) {
        const familyB = `${cloudOrigin}/t/${slugs[1]}`;
        const tenantB = writes[1].body.signedOperation.tenantId;
        const tenantState = async () => (await admin.query(`SELECT
          (SELECT count(*)::int FROM vaults.accounts WHERE tenant_id=$1) AS accounts,
          (SELECT count(*)::int FROM vaults.private_items WHERE tenant_id=$1) AS items,
          (SELECT count(*)::int FROM vaults.sync_operations WHERE tenant_id=$1) AS operations`, [tenantB])).rows[0];
        const before = await tenantState();
        const sessionA = (await members[0].context().cookies(cloudOrigin)).find(cookie => cookie.name === '__Host-127v-session');
        const crossSession = await worker.dispatch(`${familyB}/api/v1/vaults`, {
          headers: { Cookie: `${sessionA.name}=${sessionA.value}` }
        });
        assert.equal(crossSession.status, 401);
        const tryInvitation = async tenant => {
          const ceremony = await worker.dispatch(`${tenant}/api/v1/ceremony`);
          const { csrf: inviteCsrf } = await ceremony.json();
          return worker.dispatch(`${tenant}/api/v1/onboarding/register`, {
            method: 'POST', headers: { Origin: cloudOrigin, 'Content-Type': 'application/json', 'X-127V-CSRF': inviteCsrf,
              Cookie: ceremony.headers.get('set-cookie').split(';')[0] }, body: JSON.stringify(liveInvitation)
          });
        };
        const crossInvite = await tryInvitation(familyB);
        assert.equal(crossInvite.status, 400);
        assert.equal((await tryInvitation(`${cloudOrigin}/t/${slugs[0]}`)).status, 200);
        const crossWrite = await members[1].evaluate(async ({ url, body, csrf }) => {
          const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-127V-CSRF': csrf }, body: JSON.stringify(body) });
          return response.status;
        }, { ...writes[1], body: writes[0].body });
        assert.ok([400, 403, 404, 409].includes(crossWrite), `Wrong-tenant write returned ${crossWrite}`);
        const crossOperation = await members[1].evaluate(async ({ url, operation, csrf }) => {
          const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-127V-CSRF': csrf },
            body: JSON.stringify({ operation }) });
          return response.status;
        }, { url: writes[1].url.replace(/\/items$/, '/operations'), operation: writes[0].body.signedOperation, csrf: writes[1].csrf });
        assert.ok([403, 404].includes(crossOperation), `Wrong-tenant operation returned ${crossOperation}`);
        assert.deepEqual(await tenantState(), before);
        const manifest = await worker.dispatch(`${familyB}/manifest.webmanifest`);
        assert.equal((await manifest.json()).scope, `/t/${slugs[1]}/`);
        assert.equal(crossSession.headers.get('cache-control'), 'no-store');
        const pwaContext = await browser.newContext();
        try {
          for (const slug of slugs) {
            const pwa = await pwaContext.newPage();
            await pwa.goto(`${cloudOrigin}/t/${slug}/?pwa=1`);
            const scope = await pwa.evaluate(async () => {
              let timer;
              try {
                const registration = await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => {
                  timer = setTimeout(() => reject(Error('Tenant service worker did not become ready')), 15000);
                })]);
                return new URL(registration.scope).pathname;
              } finally { clearTimeout(timer); }
            });
            assert.equal(scope, `/t/${slug}/`);
          }
          for (const slug of slugs) {
            const serviceWorker = pwaContext.serviceWorkers().find(worker => new URL(worker.url()).pathname === `/t/${slug}/sw.js`);
            assert.ok(serviceWorker, 'A tenant-scoped service worker must be running');
            const paths = await serviceWorker.evaluate(async prefix => {
              const keys = await caches.keys();
              const key = keys.find(name => name.startsWith(prefix));
              if (!key) throw Error(`Missing tenant shell cache; found ${JSON.stringify(keys)}`);
              return (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname);
            }, `127vaults-tenant-shell:/t/${slug}/:`);
            assert.deepEqual(paths.filter(path => path.startsWith('/t/')).sort(),
              [`/t/${slug}/`, `/t/${slug}/manifest.webmanifest`]);
          }
        } finally { await pwaContext.close(); }
      }
      console.log(JSON.stringify({ localTimingOnly: true, vaultRuntime: worker ? 'workerd' : 'node', ...timings }));
      const original = members[0];
      await original.addInitScript(() => {
        window.fixtureToasts = [];
        window.addEventListener('vaults:toast', event => window.fixtureToasts.push(event.detail.title + ': ' + event.detail.detail));
        const media = window.matchMedia.bind(window);
        window.matchMedia = query => {
          const result = media(query);
          if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: true });
          return result;
        };
      });
      await original.reload();
      await unlock(original);
      try {
        await original.waitForFunction(() => window.__vaultsSyncState?.at && document.body.getAttribute('aria-busy') === 'false');
      } catch (error) {
        const diagnostics = await original.evaluate(() => ({ sync: window.__vaultsSyncState, toasts: window.fixtureToasts }));
        throw Error(`Initial offline replica was unavailable: ${JSON.stringify(diagnostics)}`, { cause: error });
      }
      const mutation = '**/t/family-one/api/v1/vaults/*/items';
      await original.route(mutation, route => route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue());
      const queuedTitle = 'Synthetic Cloud queued item';
      await original.locator('#new-item').click();
      await original.locator('#title').fill(queuedTitle);
      await original.locator('#save').click();
      await original.waitForFunction(() => window.__vaultsSyncState?.pending === 1);

      const switched = await original.context().newPage();
      await switched.goto(`${cloudOrigin}/t/${slugs[1]}/`);
      await switched.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      await original.locator('#vault').waitFor({ state: 'hidden' });
      assert.equal(await switched.locator('#vault').isVisible(), false);
      assert.notEqual(await switched.locator('#username').inputValue(), 'browsermember');
      await original.unroute(mutation);
      await original.reload();
      await unlock(original);
      await original.locator('#items [data-item-id]').filter({ hasText: queuedTitle }).waitFor();
      await original.waitForFunction(() => window.__vaultsSyncState?.at && window.__vaultsSyncState.pending === 0);
      assert.equal(await members[1].locator('#items [data-item-id]').filter({ hasText: queuedTitle }).count(), 0);
      const familyUrl = `${cloudOrigin}/t/${slugs[0]}/`;
      await original.locator('#settings-toggle').click();
      await original.locator('[data-settings-view="devices"]').click();
      assert.equal(await original.locator('#desktop-cloud-url').inputValue(), familyUrl);
      const code = await original.evaluate(async () => {
        const { requestBrowserEnrollment } = await import('/app/browser-enrollment.mjs');
        window.fixtureEnrollmentCall = async (path, options) => {
          const response = await fetch(location.pathname.slice(0, -1) + path, {
            method: options.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body)
          });
          if (!response.ok) throw Error(`Enrollment request failed (${response.status})`);
          return response.json();
        };
        window.fixtureEnrollment = await requestBrowserEnrollment('browsermember', window.fixtureEnrollmentCall);
        return window.fixtureEnrollment.code;
      });
      const approval = await original.context().newPage();
      await approval.goto(`${familyUrl}#enrollDevice=${code}`);
      await approval.waitForFunction(() => document.querySelector('#username')?.value === 'browsermember' &&
        document.body.getAttribute('aria-busy') === 'false');
      await approval.locator('#login-next').click();
      await unlock(approval);
      await approval.locator('#enrollment-request').waitFor();
      assert.equal(await approval.locator('#enrollment-request').inputValue(), code);
      assert.equal(new URL(approval.url()).hash, '');
      await approval.locator('#begin-enrollment').click();
      await approval.locator('#enrollment-status').filter({ hasText: 'Approved device' }).waitFor();
      const enrolled = await original.evaluate(async () => {
        const { finishBrowserEnrollment } = await import('/app/browser-enrollment.mjs');
        return Boolean(await finishBrowserEnrollment(window.fixtureEnrollment, window.fixtureEnrollmentCall));
      });
      assert.equal(enrolled, true);
      const customer = await browser.newPage(pageOptions);
      await customer.goto(customerFixture.origin);
      const customerEmail = 'browser-owner-0@example.com';
      await customer.locator('#email').fill(customerEmail);
      await customer.getByRole('button', { name: 'Request sign-in code' }).click();
      await customer.locator('#code').waitFor();
      const message = await customerFixture.manualMail(customerEmail);
      assert.ok(message, 'The Cloud-only control owner must get an operator-assisted sign-in code');
      await customer.locator('#code').fill(/code is (\d{6})/.exec(message.text)[1]);
      await customer.getByRole('button', { name: 'Verify and sign in' }).click();
      const ownFamily = customer.locator('#portal-cloud-tenants article');
      await ownFamily.filter({ hasText: slugs[0] }).waitFor();
      assert.equal(await ownFamily.count(), 1);
      assert.match(await ownFamily.innerText(), worker ? /3 seats allocated/ : /2 seats allocated/);
      await customer.getByRole('link', { name: 'Open family settings' }).click();
      await customer.locator('#login-flow').waitFor();
      assert.equal(customer.url(), `${familyUrl}?settings=family`);
      assert.equal(await customer.locator('#vault').isVisible(), false);
      assert.equal((await customer.context().cookies(familyUrl)).some(cookie => cookie.name === '__Host-127v-session'), false);
      const operatorActions = await admin.query('SELECT action,count(*)::int AS count FROM cloud.operator_audit WHERE actor=$1 GROUP BY action ORDER BY action', [localOperator]);
      assert.deepEqual(operatorActions.rows, ['activate', 'issue-setup', 'provision'].map(action => ({ action, count: 2 })));
      console.log('Local Admin provisioned two isolated families. Both enrolled and synced with real OPAQUE. Manage listed only the signed-in control owner’s family through the HTTPS directory.');
    } finally {
      await browser?.close();
      await operatorFixture?.close();
      await customerFixture?.close();
      await new Promise(resolve => realServer.close(resolve));
      await worker?.dispose();
      await browserManagementPool.end();
    }
  }
  await admin.query('BEGIN');
  await admin.query('CREATE TABLE vaults.unscoped_cloud_probe(id integer)');
  await assert.rejects(admin.query('SELECT cloud.verify_rls()'), /policy inventory is incomplete/);
  await admin.query('ROLLBACK');
  await admin.query('BEGIN');
  await admin.query('GRANT pg_read_all_data TO vaults_cloud_runtime');
  await assert.rejects(verifyCloudDatabase(admin, 'global'), /Unsafe regional Cloud runtime role/);
  await admin.query('ROLLBACK');
  console.log(JSON.stringify({ ok: true, isolatedTenants: 4, ownerEnrolled: true,
    invitedUserEnrolled: true, httpsRouting: true, firstDeployAndRerun: true, runtimeRole: 'no-login', selfHostedServerRejected: true,
    localBrowserTenants: browserEnabled ? 2 : 0, vaultRuntime: workerEnabled ? 'workerd' : 'node' }));
} catch (error) {
  if (started) try { console.error(run('logs', '--tail', '25', name)); } catch { /* unavailable */ }
  throw error;
} finally {
  if (mailCapture) {
    for (const file of readdirSync(mailCapture)) unlinkSync(join(mailCapture, file));
    rmdirSync(mailCapture);
  }
  if (runtimePool) await runtimePool.end().catch(() => {});
  if (admin) await admin.end().catch(() => {});
  if (started) try { run('rm', '-f', name); } catch { /* already removed */ }
}

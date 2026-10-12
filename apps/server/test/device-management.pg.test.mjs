import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import pg from 'pg';
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { schemaSql } from '../src/schema.mjs';
import { PgDeviceLifecycleStore } from '../src/device-lifecycle-pg.mjs';
import { createDeviceLifecycleHandler } from '../src/device-lifecycle-handler.mjs';
import { createDeviceEnrollmentHandler } from '../src/device-enrollment-handler.mjs';

// Use a dedicated, disposable database: this test installs the complete schema.
const url = process.env.VAULTS_DEVICE_TEST_DATABASE_URL;
const canonical = value => Buffer.from(JSON.stringify(value, Object.keys(value).sort()));
const pair = seed => {
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, seed)]), type: 'pkcs8', format: 'der' });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey, raw: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32) };
};
const signature = (value, key) => sign(null, canonical(value), key.privateKey).toString('base64url');

test('PostgreSQL owner can approve, enroll and revoke a second device without changing owner or vault data', { skip: !url }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const tenant = randomUUID(), owner = randomUUID(), otherAccount = randomUUID();
  const current = randomUUID(), proposed = randomUUID(), otherDevice = randomUUID();
  const currentKeys = pair(8), proposedKeys = pair(7), otherKeys = pair(9);
  const auth = { tenantId: tenant, accountId: owner, deviceId: current, sessionId: randomUUID() };
  const otherAuth = { tenantId: tenant, accountId: otherAccount, deviceId: otherDevice, sessionId: randomUUID() };
  try {
    await pool.query(schemaSql);
    await pool.query('INSERT INTO vaults.installation(id) VALUES($1)', [tenant]);
    for (const [account, username, role] of [[owner, 'DeviceOwner', 'owner'], [otherAccount, 'OtherUser', 'user']]) {
      await pool.query("INSERT INTO vaults.accounts(tenant_id,id,username,display_name,email,server_role,enrollment_state) VALUES($1,$2,$3,$3,$4,$5,'active')", [tenant, account, username, `${username}@example.invalid`, role]);
      await pool.query('INSERT INTO vaults.authentication_credentials(tenant_id,account_id,opaque_record,wrapped_root_descriptor,wrapped_root_envelope) VALUES($1,$2,$3,$4,$4)', [tenant, account, Buffer.alloc(192), Buffer.alloc(174)]);
    }
    for (const [account, device, keys] of [[owner, current, currentKeys], [otherAccount, otherDevice, otherKeys]]) {
      await pool.query('INSERT INTO vaults.devices(tenant_id,account_id,id,signing_public_key,credential_epoch,credential_epoch_seen) VALUES($1,$2,$3,$4,1,1)', [tenant, account, device, keys.raw]);
    }
    const store = new PgDeviceLifecycleStore(pool);
    const request = { deviceId: proposed, publicKey: proposedKeys.raw.toString('base64url'), purpose: 'enrollment-request', username: 'DeviceOwner' };
    const started = await store.requestEnrollment({ username: request.username, newDeviceId: proposed, newDevicePublicKey: request.publicKey, requestSignature: signature(request, proposedKeys) });
    assert.deepEqual(await store.pollEnrollment(started), { status: 'pending' });
    await assert.rejects(store.inspectEnrollment(otherAuth, { code: started.code }), { code: 'ENROLLMENT_INVALID' });
    const binding = await store.inspectEnrollment(auth, { code: started.code });
    assert.equal(binding.newDeviceId, proposed);
    await assert.rejects(store.approveEnrollmentRequest(otherAuth, { enrollmentId: started.enrollmentId, approvalSignature: signature(binding, otherKeys) }), { code: 'ENROLLMENT_INVALID' });
    const substituted = { ...binding, newDeviceId: current };
    await assert.rejects(store.approveEnrollmentRequest(auth, { enrollmentId: started.enrollmentId, approvalSignature: signature(substituted, currentKeys) }), { code: 'ENROLLMENT_INVALID' });
    assert.deepEqual(await store.approveEnrollmentRequest(auth, { enrollmentId: started.enrollmentId, approvalSignature: signature(binding, currentKeys) }), { approved: true });
    const polled = await store.pollEnrollment(started);
    assert.equal(polled.status, 'approved');
    assert.ok(verify(null, canonical(polled.binding), currentKeys.publicKey, Buffer.from(polled.approvalSignature, 'base64url')));
    await assert.rejects(store.completeEnrollmentRequest({ ...started, possessionSignature: signature({ ...binding, purpose: 'device-possession' }, otherKeys) }), { code: 'ENROLLMENT_INVALID' });
    const possession = signature({ ...binding, purpose: 'device-possession' }, proposedKeys);
    assert.deepEqual(await store.completeEnrollmentRequest({ ...started, possessionSignature: possession }), { version: 1, deviceId: proposed, credentialEpoch: 1 });
    // Lost completion replies are retried with the same possession proof.
    assert.deepEqual(await store.completeEnrollmentRequest({ ...started, possessionSignature: possession }), { version: 1, deviceId: proposed, credentialEpoch: 1 });
    assert.equal(Number((await pool.query('SELECT count(*) AS n FROM vaults.devices WHERE tenant_id=$1 AND id=$2', [tenant, proposed])).rows[0].n), 1);
    await assert.rejects(store.completeEnrollmentRequest({ ...started, possessionSignature: signature({ ...binding, purpose: 'device-possession' }, otherKeys) }), { code: 'ENROLLMENT_INVALID' });
    await assert.rejects(store.approveEnrollmentRequest(auth, { enrollmentId: started.enrollmentId, approvalSignature: signature(binding, currentKeys) }), { code: 'ENROLLMENT_INVALID' });

    // Sessions are fixed-shape test records; no password, account secret, OPAQUE
    // exchange, or real session bearer token enters this database fixture.
    for (const device of [current, proposed, otherDevice]) {
      await pool.query("INSERT INTO vaults.sessions(tenant_id,token_digest,account_id,device_id,credential_epoch,csrf_digest,csrf_cipher,expires_at) VALUES($1,$2,$3,$4,1,$5,$6,now()+interval '1 hour')",
        [tenant, createHash('sha256').update(device).digest(), device === otherDevice ? otherAccount : owner, device, Buffer.alloc(32), Buffer.alloc(60)]);
    }
    await assert.rejects(store.revoke(otherAuth, { deviceId: proposed }), { code: 'AUTH_REQUIRED' });
    // Schema 7 permits harmless owner updates and protects active ownership.
    await pool.query('UPDATE vaults.accounts SET recovery_state=recovery_state WHERE id=$1', [owner]);
    await assert.rejects(pool.query("UPDATE vaults.accounts SET server_role='user' WHERE id=$1", [owner]), { code: 'P0001' });
    assert.deepEqual(await store.revoke(auth, { deviceId: proposed.toUpperCase() }), { deviceId: proposed, status: 'revoked', lostLastDevice: false });
    await assert.rejects(store.completeEnrollmentRequest({ ...started, possessionSignature: possession }), { code: 'ENROLLMENT_INVALID' });
    const devices = (await store.list(auth)).devices;
    assert.equal(devices.find(device => device.deviceId === proposed).status, 'revoked');
    assert.equal(devices.find(device => device.deviceId === current).status, 'active');
    assert.equal(devices.length, 2);
    const sessions = (await pool.query('SELECT device_id,revoked_at FROM vaults.sessions ORDER BY device_id')).rows;
    assert.ok(sessions.find(session => session.device_id === proposed).revoked_at);
    assert.equal(sessions.find(session => session.device_id === current).revoked_at, null);
    assert.equal(sessions.find(session => session.device_id === otherDevice).revoked_at, null);
    const ownerRow = (await pool.query('SELECT server_role,recovery_state FROM vaults.accounts WHERE id=$1', [owner])).rows[0];
    assert.deepEqual(ownerRow, { server_role: 'owner', recovery_state: 'available' });
    const audit = (await pool.query("SELECT actor_device_id,subject_device_id,action,outcome FROM vaults.device_lifecycle_audit WHERE action='device.revoke'")).rows;
    assert.deepEqual(audit, [{ actor_device_id: current, subject_device_id: proposed, action: 'device.revoke', outcome: 'accepted' }]);
    await assert.rejects(store.revoke(auth, { deviceId: proposed }), { code: 'AUTH_REQUIRED' });
    await assert.rejects(store.approveEnrollmentRequest({ ...auth, deviceId: proposed }, { enrollmentId: randomUUID(), approvalSignature: signature(binding, proposedKeys) }), { code: 'AUTH_REQUIRED' });
    assert.equal(Number((await pool.query('SELECT count(*) AS n FROM vaults.private_items')).rows[0].n), 0);
    if (process.env.VAULTS_DEVICE_TEST_BINARY) {
      await rustCeremony(pool, store, auth);
    }
  } finally { await pool.end(); }
});

async function rustCeremony(pool, store, auth) {
  const tls = { cert: await readFile(process.env.VAULTS_DEVICE_TEST_CERT), key: await readFile(process.env.VAULTS_DEVICE_TEST_KEY) };
  let origin;
  const authenticate = async token => {
    assert.equal(token, 'x'.repeat(43));
    const active = (await pool.query("SELECT 1 FROM vaults.devices WHERE tenant_id=$1 AND account_id=$2 AND id=$3 AND lifecycle_status='active'", [auth.tenantId, auth.accountId, auth.deviceId])).rowCount;
    assert.equal(active, 1);
    return { ...auth, csrf: 'fixture-csrf' };
  };
  let enrollment, lifecycle;
  const server = createServer(tls, async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) { res.writeHead(400); res.end(); return; }
      if (await enrollment(req, res) || await lifecycle(req, res)) return;
      res.writeHead(404); res.end();
    } catch { res.writeHead(503); res.end('{}'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `https://127.0.0.1:${server.address().port}`;
  enrollment = createDeviceEnrollmentHandler(store, authenticate, origin);
  lifecycle = createDeviceLifecycleHandler(store, authenticate, origin);
  try {
    const child = spawn(process.env.VAULTS_DEVICE_TEST_BINARY,
      ['--exact', 'client::device_transport_tests::live_tls_postgres_device_lifecycle', '--ignored', '--nocapture'],
      { windowsHide: true, env: { ...process.env, VAULTS_DEVICE_FIXTURE_ORIGIN: origin,
        VAULTS_DEVICE_FIXTURE_CURRENT_ID: auth.deviceId, VAULTS_DEVICE_FIXTURE_CA: process.env.VAULTS_DEVICE_TEST_CA }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data', bytes => { output = (output + bytes).slice(-65536); });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    let code;
    try { code = await new Promise((done, reject) => { child.on('error', reject); child.on('close', done); }); }
    finally { clearTimeout(timer); }
    assert.equal(code, 0, output);
    const result = /DEVICE_FIXTURE_RESULT=(\{[^\r\n]+\})/.exec(output)?.[1];
    assert.ok(result, 'Rust ceremony did not report successful completion.');
    const deviceId = JSON.parse(result).deviceId;
    const row = (await pool.query('SELECT lifecycle_status FROM vaults.devices WHERE tenant_id=$1 AND account_id=$2 AND id=$3', [auth.tenantId, auth.accountId, deviceId])).rows[0];
    assert.equal(row.lifecycle_status, 'revoked');
    const audit = (await pool.query("SELECT action,outcome FROM vaults.device_lifecycle_audit WHERE subject_device_id=$1", [deviceId])).rows;
    assert.deepEqual(audit, [{ action: 'device.revoke', outcome: 'accepted' }]);
    console.log('Rust pinned-CA HTTPS enrollment, reviewed approval, possession, replay and revocation passed through the production handlers and PostgreSQL store.');
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { schemaSql, schemaV6Checksum, schemaV7Checksum, schemaV7MigrationSql, schemaV8MigrationSql, schemaV9MigrationSql, schemaV10MigrationSql } from '../src/schema.mjs';
import { migrateSchema6To7 } from '../src/schema-migration.mjs';
import { readSeatUsage } from '../src/license-seats.mjs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { hashPassword } from '../src/admin/credentials.mjs';
import { createAdminHandler } from '../src/admin/handler.mjs';
import { PgAuthStore } from '../src/auth-pg.mjs';
import { PgAdminManagement, managementInput } from '../src/admin/management.mjs';

test('admin mutation input rejects unknown actions, ownership shortcuts and extra data', () => {
  const requestId = randomUUID(), targetId = randomUUID();
  for (const value of [null, { action: 'item.get', requestId }, { action: 'role.set', requestId, targetId, role: 'owner' },
    { action: 'account.suspend', requestId, targetId, password: 'never-in-receipts' }, { action: 'account.suspend', requestId, targetId: 'bad' },
    { action: 'invitation.create', requestId, emails: ['a@example.invalid', 'a@example.invalid'], expiresInHours: 24 }]) {
    assert.throws(() => managementInput(value));
  }
  assert.deepEqual(managementInput({ action: 'invitation.create', requestId, emails: [' Alice@EXAMPLE.INVALID '], expiresInHours: 24 }).emails, ['Alice@example.invalid']);
});

const url = process.env.VAULTS_ADMIN_MANAGEMENT_DATABASE_URL;
test('PostgreSQL management preserves data, isolates permissions, audits denials and requires accepted ownership', { skip: !url }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const tenant = randomUUID(), owner = randomUUID(), alice = randomUUID(), bob = randomUUID();
  const devices = new Map(), sessions = new Map(), tokens = new Map();
  const tokenKey = Buffer.alloc(32, 6), authStore = new PgAuthStore(pool, tokenKey, Buffer.alloc(32, 7));
  const operatorOwner = { username: 'localowner', role: 'owner' }, admin = { username: 'localadmin', role: 'admin' };
  const service = new PgAdminManagement(pool, { tokenKey: Buffer.alloc(32, 6),
    // Explicit fixture entitlement; exercise the real seat query and guards.
    loadEntitlement: async () => ({ mode: 'active', maxActiveUsers: 100 }) });
  const action = (name, fields = {}, actor = operatorOwner) => service.execute(actor, { action: name, requestId: randomUUID(), ...fields });
  const account = async id => (await pool.query('SELECT server_role,suspended_at FROM vaults.accounts WHERE tenant_id=$1 AND id=$2', [tenant, id])).rows[0];
  try {
    const laterMigrations = ['', schemaV7MigrationSql, schemaV8MigrationSql, schemaV9MigrationSql, schemaV10MigrationSql].join('\n');
    assert.ok(schemaSql.endsWith(laterMigrations));
    await pool.query(schemaSql.slice(0, -laterMigrations.length));
    await pool.query('INSERT INTO vaults.installation(id) VALUES($1)', [tenant]);
    for (const [id, username, role] of [[owner, 'OriginalOwner', 'owner'], [alice, 'AliceUser', 'user'], [bob, 'BobUser', 'user']]) {
      await pool.query("INSERT INTO vaults.accounts(tenant_id,id,username,display_name,email,server_role,enrollment_state) VALUES($1,$2,$3,$3,$4,$5,'active')", [tenant, id, username, `${username}@example.invalid`, role]);
      await pool.query('INSERT INTO vaults.authentication_credentials(tenant_id,account_id,opaque_record,wrapped_root_descriptor,wrapped_root_envelope) VALUES($1,$2,$3,$4,$4)', [tenant, id, Buffer.alloc(192, 8), Buffer.alloc(174, 9)]);
      const device = randomUUID(); devices.set(id, device);
      await pool.query('INSERT INTO vaults.devices(tenant_id,account_id,id,signing_public_key,credential_epoch,credential_epoch_seen) VALUES($1,$2,$3,$4,1,1)', [tenant, id, device, Buffer.alloc(32, 7)]);
      const token = randomBytes(32), csrf = randomBytes(32), nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', tokenKey, nonce);
      tokens.set(id, token);
      const encrypted = Buffer.concat([cipher.update(csrf), cipher.final()]), csrfCipher = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
      const digest = createHmac('sha256', tokenKey).update('session').update('\0').update(token).digest();
      const session = (await pool.query("INSERT INTO vaults.sessions(tenant_id,token_digest,account_id,device_id,credential_epoch,csrf_digest,csrf_cipher,expires_at) VALUES($1,$2,$3,$4,1,$5,$6,now()+interval '1 hour') RETURNING session_id", [tenant, digest, id, device, Buffer.alloc(32), csrfCipher])).rows[0];
      sessions.set(id, session.session_id);
    }
    await pool.query('INSERT INTO vaults.schema_version(version,checksum) VALUES(6,$1)', [schemaV6Checksum]);
    const migrationClient = await pool.connect();
    try {
      assert.deepEqual(await migrateSchema6To7(migrationClient, { dryRun: true }), { from: 6, to: 7, dryRun: true });
      assert.equal((await pool.query('SELECT version FROM vaults.schema_version')).rows[0].version, 6);
      assert.equal((await pool.query("SELECT to_regclass('vaults.ownership_grants') name")).rows[0].name, null);
      assert.deepEqual(await migrateSchema6To7(migrationClient), { from: 6, to: 7, dryRun: false });
      assert.deepEqual((await pool.query('SELECT version,checksum FROM vaults.schema_version')).rows[0], { version: 7, checksum: schemaV7Checksum });
    } finally { migrationClient.release(); }
    const ciphertext = (await pool.query('SELECT account_id,opaque_record,wrapped_root_envelope FROM vaults.authentication_credentials ORDER BY account_id')).rows;
    assert.equal((await authStore.authenticate({ token: tokens.get(alice), now: new Date() })).accountId, alice);
    await assert.rejects(action('account.suspend', { targetId: owner }), { code: 'last_active_owner' });
    await assert.rejects(action('role.set', { targetId: alice, role: 'admin' }, admin), { code: 'forbidden' });
    await assert.rejects(action('account.unlock', { targetId: owner }, admin), { code: 'forbidden' });
    await assert.rejects(action('account.suspend', { targetId: alice }, { username: 'user', role: 'user' }), { code: 'forbidden' });
    const requestId = randomUUID(), input = { action: 'account.suspend', requestId, targetId: alice };
    assert.deepEqual(await service.execute(admin, input), { suspended: true });
    assert.deepEqual(await service.execute(admin, input), { suspended: true });
    assert.ok((await account(alice)).suspended_at);
    assert.equal((await readSeatUsage(pool, tenant, new Date())).activeUsers, 2);
    assert.ok((await pool.query('SELECT revoked_at FROM vaults.sessions WHERE session_id=$1', [sessions.get(alice)])).rows[0].revoked_at);
    await pool.query('UPDATE vaults.sessions SET revoked_at=NULL WHERE session_id=$1', [sessions.get(alice)]);
    await assert.rejects(authStore.authenticate({ token: tokens.get(alice), now: new Date() }), /authentication/i);
    await pool.query('UPDATE vaults.sessions SET revoked_at=now() WHERE session_id=$1', [sessions.get(alice)]);
    await assert.rejects(service.execute(admin, { ...input, targetId: bob }), { code: 'request_id_reused' });
    assert.equal((await account(bob)).suspended_at, null);
    await action('account.reactivate', { targetId: alice }, admin);
    assert.equal((await account(alice)).suspended_at, null);
    assert.ok((await pool.query('SELECT revoked_at FROM vaults.sessions WHERE session_id=$1', [sessions.get(alice)])).rows[0].revoked_at, 'reactivation must not revive old sessions');
    await action('role.set', { targetId: bob, role: 'admin' });
    assert.equal((await account(bob)).server_role, 'admin');
    await action('device.revoke', { targetId: devices.get(bob) }, admin);
    assert.equal((await pool.query('SELECT lifecycle_status FROM vaults.devices WHERE id=$1', [devices.get(bob)])).rows[0].lifecycle_status, 'revoked');
    const inviteInput = { action: 'invitation.create', requestId: randomUUID(), emails: ['invite@example.invalid'], expiresInHours: 24 };
    const invite = await service.execute(admin, inviteInput);
    assert.match(invite.token, /^127V-I1-[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(await service.execute(admin, inviteInput), invite);
    assert.equal(Number((await pool.query('SELECT count(*) n FROM vaults.invitation_records')).rows[0].n), 1);
    await action('invitation.revoke', { targetId: invite.invitationId }, admin);
    assert.ok((await pool.query('SELECT revoked_at FROM vaults.invitation_records WHERE id=$1', [invite.invitationId])).rows[0].revoked_at);
    const grant = await action('ownership.request', { targetId: alice });
    assert.equal((await account(alice)).server_role, 'user');
    const auth = { tenantId: tenant, accountId: alice, deviceId:devices.get(alice), credentialEpoch:1, sessionId: sessions.get(alice) };
    assert.equal((await service.grants(auth)).grants[0].grantId, grant.grantId);
    await assert.rejects(service.accept(auth, { grantId: grant.grantId, requestId: randomUUID() }), { status:401 });
    // A fresh independently authenticated session is required after reactivation.
    const newSession = randomUUID();
    await pool.query("INSERT INTO vaults.sessions(tenant_id,session_id,token_digest,account_id,device_id,credential_epoch,csrf_digest,csrf_cipher,expires_at,session_epoch) SELECT $1,$2,$3,$4,$5,1,$6,$7,now()+interval '1 hour',session_epoch FROM vaults.accounts WHERE tenant_id=$1 AND id=$4", [tenant, newSession, Buffer.alloc(32, 12), alice, devices.get(alice), Buffer.alloc(32), Buffer.alloc(60)]);
    auth.sessionId = newSession;
    await pool.query("UPDATE vaults.sessions SET created_at=now()-interval '6 minutes' WHERE session_id=$1", [newSession]);
    await assert.rejects(service.accept(auth, { grantId: grant.grantId, requestId: randomUUID() }), { code: 'fresh_auth_required' });
    await pool.query('UPDATE vaults.sessions SET created_at=now() WHERE session_id=$1', [newSession]);
    assert.deepEqual(await service.accept(auth, { grantId: grant.grantId, requestId: randomUUID() }), { accepted: true, role: 'owner', signInRequired: true });
    assert.equal((await account(alice)).server_role, 'owner');
    await action('role.set', { targetId: owner, role: 'user' });
    await assert.rejects(action('account.suspend', { targetId: alice }), { code: 'last_active_owner' });
    await assert.rejects(pool.query("UPDATE vaults.accounts SET server_role='owner' WHERE id=$1", [bob]), { code: 'P0001' });
    const audit = (await pool.query('SELECT actor_id,action,outcome FROM vaults.admin_control_audit')).rows;
    assert.ok(audit.some(row => row.action === 'ownership.accept' && row.outcome === 'accepted'));
    assert.ok(audit.some(row => row.action === 'role.set' && row.actor_id === 'operator:localadmin' && row.outcome === 'denied'));
    assert.equal(audit.filter(row => row.action === 'account.suspend' && row.actor_id === 'operator:localadmin' && row.outcome === 'accepted').length, 1);
    const receipts = JSON.stringify((await pool.query('SELECT result FROM vaults.admin_mutation_receipts')).rows);
    assert.ok(!receipts.includes(invite.token) && !receipts.includes('password'));
    assert.deepEqual((await pool.query('SELECT account_id,opaque_record,wrapped_root_envelope FROM vaults.authentication_credentials ORDER BY account_id')).rows, ciphertext);
    const originalGrant = await action('ownership.request', { targetId: owner });
    const originalSession = randomUUID();
    await pool.query("INSERT INTO vaults.sessions(tenant_id,session_id,token_digest,account_id,device_id,credential_epoch,csrf_digest,csrf_cipher,expires_at,session_epoch) SELECT $1,$2,$3,$4,$5,1,$6,$7,now()+interval '1 hour',session_epoch FROM vaults.accounts WHERE tenant_id=$1 AND id=$4", [tenant, originalSession, randomBytes(32), owner, devices.get(owner), Buffer.alloc(32), Buffer.alloc(60)]);
    await service.accept({ tenantId: tenant, accountId: owner, deviceId: devices.get(owner), credentialEpoch: 1, sessionId: originalSession }, { grantId: originalGrant.grantId, requestId: randomUUID() });
    const concurrent = await Promise.allSettled([action('role.set', { targetId: owner, role: 'user' }), action('role.set', { targetId: alice, role: 'user' })]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.find(result => result.status === 'rejected').reason.code, 'last_active_owner');
    assert.equal(Number((await pool.query("SELECT count(*) n FROM vaults.accounts WHERE server_role='owner' AND suspended_at IS NULL AND enrollment_state='active'")).rows[0].n), 1);
    if (process.env.VAULTS_ADMIN_MANAGEMENT_BROWSER === '1') await browserManagement(pool, service);
  } finally { await pool.end(); }
});

async function browserManagement(pool, management) {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.VAULTS_PLAYWRIGHT_MODULE || 'playwright');
  const password = 'synthetic-admin-browser-password', hashed = hashPassword(password);
  const operator = { username: 'localowner', role: 'owner', salt: Buffer.from(hashed.salt, 'base64url'), hash: Buffer.from(hashed.hash, 'base64url') };
  const origin = 'https://admin-management.example.test';
  const handler = createAdminHandler({ pool, operators: [operator], origin, schemaVersion: 7, management });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.VAULTS_BROWSER_CHANNEL || 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(10_000);
    await context.route(origin + '/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname + new URL(req.url()).search;
      const response = await fetch(base + path, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/admin/');
    await page.getByLabel('Operator name').fill('localowner');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    const bob = page.getByRole('row').filter({ hasText: 'BobUser' });
    await bob.getByRole('button', { name: 'View account details for BobUser', exact: true }).click();
    await page.getByRole('button', { name: 'Suspend account', exact: true }).click();
    await page.getByLabel('Confirm your operator password').fill(password);
    await page.locator('#management-submit').click();
    await page.getByText('Action completed.', { exact: false }).waitFor();
    await page.locator('#management-close').click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await bob.getByText('suspended', { exact: false }).waitFor();
    await bob.getByRole('button', { name: 'View account details for BobUser', exact: true }).click();
    await page.getByRole('button', { name: 'Reactivate account', exact: true }).click();
    await page.getByLabel('Confirm your operator password').fill(password); await page.locator('#management-submit').click();
    await page.getByText('Action completed.', { exact: false }).waitFor(); await page.locator('#management-close').click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await bob.getByRole('button', { name: 'View account details for BobUser', exact: true }).click();
    await page.getByRole('button', { name: 'Request ownership acceptance', exact: true }).click();
    await page.getByLabel('Confirm your operator password').fill(password); await page.locator('#management-submit').click();
    await page.getByText('Ownership request created.', { exact: false }).waitFor(); await page.locator('#management-close').click();
    await page.getByRole('button', { name: 'Roles & ownership', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel request', exact: true }).click();
    await page.getByLabel('Confirm your operator password').fill(password); await page.locator('#management-submit').click();
    await page.getByText('Action completed.', { exact: false }).waitFor(); await page.locator('#management-close').click();
    await page.getByRole('button', { name: 'Invitations', exact: true }).click();
    await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
    await page.getByLabel('Recipient emails, one per line').fill('browser-fixture@example.invalid');
    await page.getByLabel('Confirm your operator password').fill(password); await page.locator('#management-submit').click();
    await page.getByLabel('Invitation code').waitFor();
    assert.match(await page.getByLabel('Invitation code').inputValue(), /^127V-I1-/);
    assert.equal(await page.getByLabel('Confirm your operator password').inputValue(), '');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#management-close').click();
    assert.equal(await page.getByLabel('Invitation code').count(), 0);
    await page.getByRole('button', { name: 'Audit', exact: true }).click();
    await page.getByRole('cell', { name: 'invitation.create', exact: true }).first().waitFor();
    await page.getByLabel('Outcome', { exact: true }).selectOption('denied');
    await page.getByRole('button', { name: 'Apply filter' }).click();
    await page.getByRole('cell', { name: 'denied', exact: true }).first().waitFor();
    assert.equal(await page.getByRole('cell', { name: 'accepted', exact: true }).count(), 0);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download redacted JSON' }).click();
    const download = await downloadEvent;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const { events } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.ok(events.length > 0);
    for (const event of events) {
      assert.equal(event.outcome, 'denied');
      assert.deepEqual(Object.keys(event).sort(), ['action', 'createdAt', 'outcome']);
    }
    assert.deepEqual(errors, []);
    console.log('Edge management walkthrough passed: suspension/reactivation, ownership request/cancel, invitation code clearing, audit and narrow layout.');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
}

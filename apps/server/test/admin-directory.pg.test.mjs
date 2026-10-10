import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { schemaSql } from '../src/schema.mjs';
import { directoryInput, readDirectory } from '../src/admin/directory.mjs';

// Opt-in only: the wrapper creates an empty, in-memory PostgreSQL container.
const url = process.env.VAULTS_ADMIN_TEST_DATABASE_URL;
test('PostgreSQL admin directory covers every account, literal searches and device lifecycle filters', { skip: !url }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const tenant = randomUUID();
  const input = (kind, values = {}) => directoryInput(new URLSearchParams(values), kind);
  try {
    // Never overwrite a populated database, even if a caller supplies the wrong URL.
    const schemas = await pool.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg_%'");
    const tables = await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='public'");
    assert.equal(schemas.rowCount, 0, 'Requires a new empty fixture database');
    assert.equal(tables.rowCount, 0, 'Requires an empty public schema');
    await pool.query(schemaSql);
    await pool.query('INSERT INTO vaults.installation(id) VALUES($1)', [tenant]);
    await pool.query(`INSERT INTO vaults.accounts(tenant_id,id,username,display_name,email,server_role,enrollment_state,email_verified,created_at)
      SELECT $1,('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'user' || lpad(i::text,3,'0'),
        CASE WHEN i=136 THEN 'Literal %_ markers café' ELSE 'Person ' || i END,'user' || i || '@example.invalid',
        CASE WHEN i=0 THEN 'owner' ELSE 'user' END,CASE WHEN i%5=0 THEN 'pending' ELSE 'active' END,i%3<>0,
        '2026-10-10 00:00:00+00'::timestamptz
      FROM generate_series(0,136) i`, [tenant]);
    await pool.query(`INSERT INTO vaults.devices(tenant_id,account_id,id,signing_public_key,credential_epoch,credential_epoch_seen,lifecycle_status,protection_class,credential_state,revoked_at,created_at)
      SELECT tenant_id,id,('d0000000-0000-4000-8000-' || right(id::text,12))::uuid,decode(repeat('ab',32),'hex'),1,1,
        CASE right(id::text,12)::int%4 WHEN 0 THEN 'active' WHEN 1 THEN 'revoked' WHEN 2 THEN 'replaced' ELSE 'pending' END,
        CASE right(id::text,12)::int%4 WHEN 0 THEN 'unknown' WHEN 1 THEN 'software' WHEN 2 THEN 'platform' ELSE 'hardware' END,
        CASE WHEN right(id::text,12)::int%3=0 THEN 'rotation_required' ELSE 'current' END,
        CASE WHEN right(id::text,12)::int%4 IN (1,2) THEN now() ELSE NULL END,created_at
      FROM vaults.accounts`);
    const seen = [];
    for (let page = 1; page <= 6; page++) {
      const data = await readDirectory(pool, 'users', input('users', { page: String(page) }));
      assert.equal(data.total, 137);
      assert.equal(data.pageCount, 6);
      assert.equal(data.page, page);
      assert.equal(data.users.length, page === 6 ? 12 : 25);
      seen.push(...data.users.map(account => account.id));
    }
    assert.equal(new Set(seen).size, 137, 'Equal timestamps must not repeat or omit records between pages');
    assert.deepEqual(seen, [...seen].sort());
    const literal = await readDirectory(pool, 'users', input('users', { q: '%_' }));
    assert.equal(literal.total, 1, 'SQL wildcard characters are literal search text');
    assert.equal(literal.users[0].username, 'user136');
    const injection = await readDirectory(pool, 'users', input('users', { q: "' OR true --" }));
    assert.equal(injection.total, 0);
    const email = await readDirectory(pool, 'users', input('users', { q: 'USER136@EXAMPLE.INVALID' }));
    assert.equal(email.total, 1);
    const idSearch = await readDirectory(pool, 'users', input('users', { q: seen[136] }));
    assert.equal(idSearch.total, 1);
    const pending = await readDirectory(pool, 'users', input('users', { status: 'pending', role: 'user', pageSize: '100' }));
    assert.equal(pending.total, 27);
    assert.ok(pending.users.every(account => account.role === 'user' && account.status === 'pending'));
    const owner = await readDirectory(pool, 'users', input('users', { role: 'owner' }));
    assert.equal(owner.users[0].deviceCount, 1);
    const revoked = await readDirectory(pool, 'devices', input('devices', { status: 'revoked', protection: 'software', pageSize: '100' }));
    assert.equal(revoked.total, 34);
    assert.ok(revoked.devices.every(device => device.revokedAt && device.status === 'revoked' && device.protection === 'software'));
    const scoped = await readDirectory(pool, 'devices', input('devices', { accountId: seen[136] }));
    assert.equal(scoped.total, 1);
    assert.equal(scoped.devices[0].username, 'user136');
    const deviceSearch = await readDirectory(pool, 'devices', input('devices', { q: scoped.devices[0].id }));
    assert.equal(deviceSearch.total, 1);
    const clamped = await readDirectory(pool, 'devices', input('devices', { accountId: seen[136], page: '1000' }));
    assert.equal(clamped.page, 1);
    const before = await pool.query('SELECT count(*)::int AS total FROM vaults.accounts');
    assert.equal(before.rows[0].total, 137, 'Directory reads must preserve all account rows');
  } finally { await pool.end(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTenantScopedPool, verifyCloudRuntimeRole } from '../internal-cloud/scoped-pool.mjs';
import { createInternalCloudRequestBoundary } from '../internal-cloud/request-boundary.mjs';
import { schemaChecksum } from '../src/schema.mjs';
import { overlayChecksum } from '../internal-cloud/operator.mjs';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';

function fakePool() {
  const events = [];
  return { events, connect: async () => ({
    query: async (sql, values) => { events.push({ sql, values }); return { rows: [{ ok: true }], rowCount: 1 }; },
    release: destroy => events.push({ release: true, destroy: Boolean(destroy) })
  }) };
}

test('single queries and explicit transactions set tenant context locally', async () => {
  const base = fakePool();
  const pool = createTenantScopedPool(base, alice);
  await pool.query('SELECT 1');
  assert.deepEqual(base.events.map(x => x.sql).filter(Boolean), ['BEGIN', "SELECT set_config('vaults.tenant_id',$1,true)", 'SELECT 1', 'COMMIT']);
  assert.deepEqual(base.events[1].values, [alice]);
  const client = await pool.connect();
  await assert.rejects(client.query('SELECT 1'), /active tenant transaction/);
  await client.query('BEGIN');
  await client.query('SELECT 2');
  await client.query('COMMIT');
  client.release();
  assert.deepEqual(base.events.at(-1), { release: true, destroy: false });
  await assert.rejects(client.query('SELECT 3'), /released/);
});

test('unfinished transactions destroy the connection and invalid tenant IDs are refused', async () => {
  const base = fakePool();
  assert.throws(() => createTenantScopedPool(base, 'client-supplied'));
  const client = await createTenantScopedPool(base, bob).connect();
  await client.query('BEGIN');
  client.release();
  assert.deepEqual(base.events.at(-1), { release: true, destroy: true });
});

test('failed rollback destroys a single-query connection before pool reuse', async () => {
  const events = [];
  const base = { connect: async () => ({
    query: async sql => {
      events.push(sql);
      if (sql === 'SELECT fail') throw new Error('query failed');
      if (sql === 'ROLLBACK') throw new Error('connection lost');
      return { rows: [] };
    },
    release: destroy => events.push({ destroy })
  }) };
  await assert.rejects(createTenantScopedPool(base, alice).query('SELECT fail'), /query failed/);
  assert.deepEqual(events.at(-1), { destroy: true });
});

test('failed tenant context setup cannot return a connection with an open transaction', async () => {
  const events = [];
  const base = { connect: async () => ({
    query: async sql => {
      events.push(sql);
      if (sql.startsWith('SELECT set_config') || sql === 'ROLLBACK') throw new Error('connection lost');
      return { rows: [] };
    },
    release: destroy => events.push({ destroy })
  }) };
  const client = await createTenantScopedPool(base, alice).connect();
  await assert.rejects(client.query('BEGIN'), /connection lost/);
  await assert.rejects(client.query('BEGIN'), /already started/);
  client.release();
  assert.deepEqual(events.at(-1), { destroy: true });
});

test('one scoped connection serializes queries so tenant context cannot race', async () => {
  let finish;
  const base = { connect: async () => ({
    query: sql => sql === 'SELECT slow' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ rows: [] }),
    release: () => {}
  }) };
  const client = await createTenantScopedPool(base, alice).connect();
  await client.query('BEGIN');
  const slow = client.query('SELECT slow');
  await assert.rejects(client.query('COMMIT'), /Concurrent Cloud queries/);
  finish({ rows: [] });
  await slow;
  await client.query('COMMIT');
  client.release();
});

test('runtime login role must be unprivileged and inherit only Cloud runtime access', async () => {
  const safe = { rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreatedb: false,
    rolcreaterole: false, rolreplication: false, is_login_identity: true, has_runtime_role: true,
    owns_tenant_table: false, has_extra_role: false };
  const pool = row => ({ query: async () => ({ rows: [row] }) });
  await verifyCloudRuntimeRole(pool(safe));
  for (const key of ['rolsuper', 'rolbypassrls', 'owns_tenant_table', 'has_extra_role']) {
    await assert.rejects(verifyCloudRuntimeRole(pool({ ...safe, [key]: true })));
  }
  await assert.rejects(verifyCloudRuntimeRole(pool({ ...safe, has_runtime_role: false })));
});

test('request boundary verifies TLS, SNI, host, and region before handing out a scoped pool', async () => {
  const base = fakePool();
  base.query = async (sql, values) => sql.includes('rolcanlogin')
    ? { rows: [{ rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreatedb: false,
      rolcreaterole: false, rolreplication: false, is_login_identity: true, has_runtime_role: true,
      owns_tenant_table: false, has_extra_role: false }] }
    : sql.includes('schema_manifest')
      ? { rows: [{ version: 1, region: 'asia', base_checksum: schemaChecksum, overlay_checksum: overlayChecksum }] }
      : sql.includes('verify_rls')
        ? { rows: [{ verify_rls: null }] }
        : { rows: [{ id: values[0] === 'alice' && values[1] === 'asia' ? alice : null }] };
  const boundary = await createInternalCloudRequestBoundary({ pool: base, region: 'asia', publicOrigin: 'https://alice.asia.example.com',
    handle: async (_req, _res, context) => {
      assert.equal(context.tenant.id, alice);
      assert.equal(context.origin, 'https://alice.asia.example.com');
      assert.throws(() => context.requirePrincipal({ tenantId: bob, accountId: bob, deviceId: bob }));
      await context.pool.query('SELECT 1');
      return true;
    } });
  const req = { url: '/t/alice/api/v1/devices', rawHeaders: ['Host', 'alice.asia.example.com'],
    headers: { host: 'alice.asia.example.com', origin: 'https://alice.asia.example.com' },
    socket: { encrypted: true, servername: 'alice.asia.example.com' } };
  assert.equal(await boundary(req, {}), true);
  await assert.rejects(boundary({ ...req, socket: { encrypted: false, servername: 'alice.asia.example.com' } }, {}));
  await assert.rejects(boundary({ ...req, socket: { encrypted: true, servername: 'bob.asia.example.com' } }, {}));
});

test('request boundary refuses a changed regional schema or failed RLS verification', async () => {
  const role = { rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreatedb: false,
    rolcreaterole: false, rolreplication: false, is_login_identity: true, has_runtime_role: true,
    owns_tenant_table: false, has_extra_role: false };
  const pool = (checksum, rlsFails = false) => ({ query: async sql => {
    if (sql.includes('rolcanlogin')) return { rows: [role] };
    if (sql.includes('schema_manifest')) return { rows: [{ version: 1, region: 'asia',
      base_checksum: schemaChecksum, overlay_checksum: checksum }] };
    if (sql.includes('verify_rls') && rlsFails) throw new Error('RLS disabled');
    return { rows: [] };
  } });
  await assert.rejects(createInternalCloudRequestBoundary({ pool: pool('changed'), region: 'asia', handle: () => {} }),
    /Unknown or changed regional Cloud schema/);
  await assert.rejects(createInternalCloudRequestBoundary({ pool: pool(overlayChecksum, true), region: 'asia', handle: () => {} }),
    /RLS disabled/);
});

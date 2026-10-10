import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directoryInput, DirectoryInputError, readDirectory } from '../src/admin/directory.mjs';

test('directory queries have bounded pagination and allowlisted filters', () => {
  assert.deepEqual(directoryInput(new URLSearchParams(), 'users'), { q: '', page: 1, pageSize: 25, status: '', role: '' });
  assert.equal(directoryInput(new URLSearchParams('q=%20Alice%20&page=3&pageSize=50&status=active&role=user'), 'users').q, 'Alice');
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1e2', 'page=1000001', 'pageSize=101', 'pageSize=', 'page=1&page=2', 'sort=email', 'status=suspended', 'role=root', `q=${'x'.repeat(121)}`, 'q=%00']) {
    assert.throws(() => directoryInput(new URLSearchParams(query), 'users'), DirectoryInputError, query);
  }
  for (const query of ['role=owner', 'protection=trusted', 'accountId=hello%27', 'status=deleted']) {
    assert.throws(() => directoryInput(new URLSearchParams(query), 'devices'), DirectoryInputError, query);
  }
});

test('account search is literal and parameterized, with stable ordering and active device counts', async () => {
  const calls = [];
  const pool = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT count')) return { rows: [{ total: 126 }] };
    return { rows: [{ id: 'a', username: 'alice', display_name: '<Alice>', email: 'alice@example.invalid', server_role: 'user', enrollment_state: 'active', email_verified: false, device_count: 2, created_at: '2026-10-10' }] };
  } };
  const q = "%_' OR true --";
  const data = await readDirectory(pool, 'users', directoryInput(new URLSearchParams({ q, page: '6', status: 'active', role: 'user' }), 'users'));
  assert.equal(data.total, 126);
  assert.equal(data.pageCount, 6);
  assert.equal(data.hasNext, false);
  assert.equal(data.hasPrevious, true);
  assert.equal(data.users[0].emailVerified, false);
  assert.equal(data.users[0].deviceCount, 2);
  assert.deepEqual(calls[0].values, [q, 'active', 'user']);
  assert.deepEqual(calls[1].values, [q, 'active', 'user', 25, 125]);
  assert.doesNotMatch(calls[0].sql, /OR true|ILIKE/);
  assert.match(calls[0].sql, /position\(lower\(\$1\)/);
  assert.match(calls[1].sql, /d.tenant_id=a.tenant_id.*d.lifecycle_status='active'/s);
  assert.match(calls[1].sql, /ORDER BY a.created_at DESC,a.id,a.tenant_id LIMIT \$4 OFFSET \$5/);
});

test('device directory filters an account and clamps stale page requests', async () => {
  const calls = [];
  const pool = { async query(sql, values) {
    calls.push({ sql, values });
    return sql.startsWith('SELECT count') ? { rows: [{ total: 2 }] } : { rows: [{ id: 'device', account_id: 'account', username: 'alice', display_name: 'Alice', lifecycle_status: 'revoked', protection_class: 'software', credential_state: 'stale', revoked_at: '2026-10-10' }] };
  } };
  const data = await readDirectory(pool, 'devices', directoryInput(new URLSearchParams('accountId=account&status=revoked&protection=software&page=9'), 'devices'));
  assert.equal(data.page, 1);
  assert.equal(data.hasPrevious, false);
  assert.equal(data.devices[0].revokedAt, '2026-10-10');
  assert.deepEqual(calls[1].values, ['revoked', 'software', 'account', 25, 0]);
  assert.match(calls[0].sql, /a.tenant_id=d.tenant_id/);
  assert.match(calls[0].sql, /d.account_id::text=\$3/);
});

test('an empty directory has one navigable page and no fabricated rows', async () => {
  const pool = { async query(sql) { return sql.startsWith('SELECT count') ? { rows: [{ total: 0 }] } : { rows: [] }; } };
  const data = await readDirectory(pool, 'users', directoryInput(new URLSearchParams('page=3'), 'users'));
  assert.deepEqual(data, { users: [], total: 0, page: 1, pageSize: 25, pageCount: 1, hasPrevious: false, hasNext: false });
});

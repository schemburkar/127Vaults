import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directoryInput, DirectoryInputError, readDirectory } from '../src/admin/directory.mjs';

const withConnection = pool => ({ connect: async () => ({ query: (sql, values) => sql.startsWith('SELECT') ? pool.query(sql, values) : Promise.resolve({}), release() {} }) });

test('directory queries have bounded pagination and allowlisted filters', () => {
  assert.deepEqual(directoryInput(new URLSearchParams(), 'users'), { q: '', page: 1, pageSize: 25, sort: 'newest', status: '', role: '', signIn: '' });
  assert.equal(directoryInput(new URLSearchParams('q=%20Alice%20&page=3&pageSize=50&status=active&role=user'), 'users').q, 'Alice');
  assert.equal(directoryInput(new URLSearchParams('status=suspended'), 'users').status, 'suspended');
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1e2', 'page=1000001', 'pageSize=101', 'pageSize=', 'page=1&page=2', 'sort=email', 'status=deleted', 'role=root', `q=${'x'.repeat(121)}`, 'q=%00']) {
    assert.throws(() => directoryInput(new URLSearchParams(query), 'users'), DirectoryInputError, query);
  }
  for (const query of ['role=owner', 'protection=trusted', 'credential=verified', 'accountId=hello%27', 'status=deleted']) {
    assert.throws(() => directoryInput(new URLSearchParams(query), 'devices'), DirectoryInputError, query);
  }
});

test('directory ordering comes from a kind-specific allowlist', async () => {
  for (const [kind, sort, pattern] of [['users', 'username', /ORDER BY a.username_key,a.id/], ['devices', 'oldest', /ORDER BY d.created_at ASC,d.id/], ['invitations', 'expires', /ORDER BY r.expires_at ASC,r.id/]]) {
    const queries = [];
    const pool = { async query(sql) { queries.push(sql); return sql.startsWith('SELECT count') ? { rows: [{ total: 1 }] } : { rows: [] }; } };
    await readDirectory(withConnection(pool), kind, directoryInput(new URLSearchParams({ sort }), kind));
    assert.match(queries[1], pattern);
  }
  for (const [kind, sort] of [['users', 'expires'], ['devices', 'username'], ['invitations', 'newest; DROP TABLE vaults.accounts'], ['users', 'toString']]) {
    assert.throws(() => directoryInput(new URLSearchParams({ sort }), kind), DirectoryInputError);
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
  const data = await readDirectory(withConnection(pool), 'users', directoryInput(new URLSearchParams({ q, page: '6', status: 'active', role: 'user' }), 'users'));
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
  const data = await readDirectory(withConnection(pool), 'devices', directoryInput(new URLSearchParams('accountId=account&status=revoked&protection=software&page=9'), 'devices'));
  assert.equal(data.page, 1);
  assert.equal(data.hasPrevious, false);
  assert.equal(data.devices[0].revokedAt, '2026-10-10');
  assert.deepEqual(calls[1].values, ['revoked', 'software', 'account', 25, 0]);
  assert.match(calls[0].sql, /a.tenant_id=d.tenant_id/);
  assert.match(calls[0].sql, /d.account_id::text=\$3/);
});

test('an empty directory has one navigable page and no fabricated rows', async () => {
  const pool = { async query(sql) { return sql.startsWith('SELECT count') ? { rows: [{ total: 0 }] } : { rows: [] }; } };
  const data = await readDirectory(withConnection(pool), 'users', directoryInput(new URLSearchParams('page=3'), 'users'));
  assert.deepEqual(data, { users: [], total: 0, page: 1, pageSize: 25, pageCount: 1, hasPrevious: false, hasNext: false });
});

test('invitation directory exposes recipient state without invitation or verification secrets', async () => {
  const calls = [];
  const pool = { async query(sql, values) {
    calls.push({ sql, values });
    return sql.startsWith('SELECT count') ? { rows: [{ total: 1 }] } : { rows: [{ id: 'invitation', email: 'invitee@example.invalid', created_by: 'owner', status: 'pending', expires_at: '2026-10-11', token_digest: 'must-never-leave-store', verification_code: 'must-never-leave-store' }] };
  } };
  const input = directoryInput(new URLSearchParams('q=invitee&status=pending'), 'invitations');
  const data = await readDirectory(withConnection(pool), 'invitations', input);
  assert.equal(data.invitations[0].createdBy, 'owner');
  assert.equal(data.invitations[0].status, 'pending');
  assert.doesNotMatch(JSON.stringify(data), /token|verification|must-never/);
  assert.doesNotMatch(calls[1].sql, /token_digest|verification_code|SELECT \*/);
  assert.match(calls[0].sql, /e.tenant_id=r.tenant_id/);
  assert.match(calls[0].sql, /e.redeemed_at IS NOT NULL THEN 'redeemed'.*r.revoked_at IS NOT NULL THEN 'revoked'/);
  assert.deepEqual(calls[0].values, ['invitee', 'pending']);
  assert.throws(() => directoryInput(new URLSearchParams('status=active'), 'invitations'), DirectoryInputError);
  assert.throws(() => directoryInput(new URLSearchParams('accountId=account'), 'invitations'), DirectoryInputError);
});

test('failed snapshot reads roll back and discard connections when rollback fails', async () => {
  for (const brokenRollback of [false, true]) {
    const failure = Error('Synthetic directory read failure');
    const statements = [];
    let released;
    const pool = { async connect() { return { async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT')) throw failure;
      if (sql === 'ROLLBACK' && brokenRollback) throw Error('Connection lost');
      return {};
    }, release(discard) { released = discard; } }; } };
    await assert.rejects(readDirectory(pool, 'users', directoryInput(new URLSearchParams(), 'users')), error => error === failure);
    assert.equal(statements[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(statements.at(-1), 'ROLLBACK');
    assert.equal(statements.includes('COMMIT'), false);
    assert.equal(released, brokenRollback);
  }
});

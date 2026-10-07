import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PgOnboardingStore } from '../src/onboarding-pg.mjs';

test('first-owner enrollment refuses an inactive signed license before writing account data', async () => {
  const tenantId = randomUUID();
  const statements = [];
  const client = { query: async sql => {
    statements.push(sql);
    if (sql.includes('FROM vaults.bootstrap_tokens')) return { rows: [{ tenant_id: tenantId }] };
    if (sql.includes("server_role='owner'")) return { rowCount: 0 };
    return { rows: [], rowCount: 0 };
  }, release() {} };
  const store = new PgOnboardingStore({ connect: async () => client }, {
    loadEntitlement: async () => ({ mode: 'revoked', maxActiveUsers: 5 }) });
  await assert.rejects(store.bootstrapOwner({ bootstrapDigest: Buffer.alloc(32), now: new Date(), candidate: {} }),
    error => error.code === 'license_inactive' && error.status === 403);
  assert.ok(statements.includes('ROLLBACK'));
  assert.ok(!statements.some(sql => sql.includes('INSERT INTO vaults.accounts')));
});

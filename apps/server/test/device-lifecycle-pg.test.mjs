import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDeviceLifecycleStore } from '../src/device-lifecycle-pg.mjs';

test('enrollment reads the account credential epoch from authentication credentials', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM vaults.devices')) return { rows: [{ signing_public_key: Buffer.alloc(32), auth_epoch: 1 }] };
      if (sql.includes('JOIN vaults.authentication_credentials')) return { rows: [{ credential_epoch: 1, session_epoch: 1, recovery_state: 'available' }] };
      if (sql.includes('SELECT 1 FROM vaults.devices')) return { rowCount: 0, rows: [] };
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  const store = new PgDeviceLifecycleStore({ async connect() { return client; } }, {
    now: () => new Date('2026-09-12T00:00:00.000Z'),
    random: size => Buffer.alloc(size, 7)
  });
  const result = await store.beginEnrollment({
    tenantId: '10000000-0000-4000-8000-000000000001',
    accountId: '20000000-0000-4000-8000-000000000001',
    deviceId: '30000000-0000-4000-8000-000000000001',
    sessionId: '40000000-0000-4000-8000-000000000001'
  }, {
    newDeviceId: '50000000-0000-4000-8000-000000000001',
    newDevicePublicKey: Buffer.alloc(32, 9).toString('base64url'),
    protectionClass: 'unknown',
    protectionVerified: false
  });
  assert.equal(result.newDeviceId, '50000000-0000-4000-8000-000000000001');
  assert.ok(queries.some(sql => sql.includes('JOIN vaults.authentication_credentials')));
});

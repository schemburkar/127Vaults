import test from 'node:test';
import assert from 'node:assert/strict';
import { activateCloudTenant, initializeCloudDatabase, linkCloudControlOwner, overlayChecksum, prepareCloudTenant, reserveCloudTenant } from '../internal-cloud/operator.mjs';

test('internal regional initialization refuses a database containing any user schema', async () => {
  const calls = [];
  const client = { query: async (sql) => {
    calls.push(sql);
    return sql.includes('FROM pg_namespace') ? { rowCount: 1 } : { rowCount: 0 };
  } };
  await assert.rejects(initializeCloudDatabase(client, 'asia'), /must be empty/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.some(sql => sql.includes('CREATE SCHEMA vaults')), false);
});

test('reservation rejects malformed or noncanonical slugs before touching the database', async () => {
  const client = { query: async () => { throw new Error('database reached'); } };
  for (const slug of ['Alice', 'alice.example.com', '-alice', 'alice%2fbob']) {
    await assert.rejects(reserveCloudTenant(client, { region: 'asia', slug, maxActiveUsers: 1 }), /tenant slug/);
  }
  assert.match(overlayChecksum, /^[a-f0-9]{64}$/);
});

test('preparation and activation reject invalid identity before database access', async () => {
  const client = { query: async () => { throw new Error('database reached'); } };
  await assert.rejects(prepareCloudTenant(client, { region: 'global', slug: 'bad..example.com', setupBytes: Buffer.alloc(96) }));
  await assert.rejects(prepareCloudTenant(client, { region: 'global', slug: 'alice', setupBytes: Buffer.alloc(4) }), /setup/);
  await assert.rejects(activateCloudTenant(client, { region: 'global', slug: 'Alice' }));
  await assert.rejects(linkCloudControlOwner(client, { region: 'global', slug: 'alice',
    ownerIdentityId: 'invalid', ownerEmail: 'admin@example.com' }), /control owner/);
});

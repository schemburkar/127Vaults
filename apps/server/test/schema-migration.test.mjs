import test from 'node:test';
import assert from 'node:assert/strict';
import {
  schemaChecksum, schemaV1Checksum, schemaV2Checksum, schemaV3Checksum, schemaV4Checksum, schemaV5Checksum, schemaV2MigrationSql, schemaV3MigrationSql, schemaV4MigrationSql, schemaV5MigrationSql, schemaV6MigrationSql, requireSchema
} from '../src/schema.mjs';
import { MANIFEST_ERROR, migrateSchema1To2, migrateSchema2To3, migrateSchema3To4, migrateSchema4To5, migrateSchema5To6, schemaStatus } from '../src/schema-migration.mjs';

const counts = { accounts: '2', devices: '2', sessions: '1', vaults: '1', items: '3' };
class MigrationClient {
  constructor({ version = 1, checksum = schemaV1Checksum, invalid = '0', cloud = false } = {}) {
    this.version = version; this.checksum = checksum; this.invalid = invalid; this.cloud = cloud; this.calls = [];
  }
  async query(sql, parameters) {
    this.calls.push({ sql, parameters });
    if (sql.includes("to_regclass('vaults.schema_version')")) return { rows: [{ relation: 'vaults.schema_version' }], rowCount: 1 };
    if (sql.startsWith('SELECT version, checksum')) return { rows: [{ version: this.version, checksum: this.checksum }], rowCount: 1 };
    if (sql.includes("nspname='cloud'")) return { rows: [{ present: this.cloud }], rowCount: 1 };
    if (sql.startsWith('SELECT\n  (SELECT count(*)')) return { rows: [counts], rowCount: 1 };
    if (sql.startsWith('SELECT\n    (SELECT count(*)')) return { rows: [{ count: this.invalid }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
}

test('frozen schema-1 checksum and schema-2 recipe checksum are distinct', () => {
  assert.match(schemaV1Checksum, /^[0-9a-f]{64}$/);
  assert.match(schemaChecksum, /^[0-9a-f]{64}$/);
  assert.notEqual(schemaChecksum, schemaV1Checksum);
});

test('migration refuses an unknown version or checksum before DDL', async () => {
  for (const input of [{ version: 3 }, { checksum: '0'.repeat(64) }]) {
    const client = new MigrationClient(input);
    await assert.rejects(migrateSchema1To2(client), { message: MANIFEST_ERROR });
    assert.equal(client.calls.some(call => call.sql === schemaV2MigrationSql), false);
    assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  }
});

test('migration locks, validates, writes manifest last, and commits', async () => {
  const client = new MigrationClient();
  assert.deepEqual(await migrateSchema1To2(client), { from: 1, to: 2, dryRun: false });
  const sql = client.calls.map(call => call.sql);
  assert.deepEqual(sql.slice(0, 4), ['BEGIN', "SET LOCAL lock_timeout = '5s'", 'SELECT pg_advisory_xact_lock(127, 1)', 'SELECT version, checksum FROM vaults.schema_version FOR UPDATE']);
  assert.equal(sql.at(-2), 'UPDATE vaults.schema_version SET version=2, checksum=$1 WHERE singleton=true');
  assert.equal(client.calls.at(-2).parameters[0], schemaV2Checksum);
  assert.equal(sql.at(-1), 'COMMIT');
});

test('dry run executes complete migration then rolls back', async () => {
  const client = new MigrationClient();
  assert.deepEqual(await migrateSchema1To2(client, { dryRun: true }), { from: 1, to: 2, dryRun: true });
  assert.equal(client.calls.some(call => call.sql === schemaV2MigrationSql), true);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('schema status and runtime requirement distinguish known manifests', async () => {
  assert.deepEqual(await schemaStatus(new MigrationClient()), { state: 'migration-required', version: 1 });
  const old = new MigrationClient({ version: 2, checksum: schemaV2Checksum });
  assert.deepEqual(await schemaStatus(old), { state: 'migration-required', version: 2 });
  assert.deepEqual(await schemaStatus(new MigrationClient({ version: 3, checksum: schemaV3Checksum })), { state: 'migration-required', version: 3 });
  assert.deepEqual(await schemaStatus(new MigrationClient({ version: 4, checksum: schemaV4Checksum })), { state: 'migration-required', version: 4 });
  assert.deepEqual(await schemaStatus(new MigrationClient({ version: 5, checksum: schemaV5Checksum })), { state: 'migration-required', version: 5 });
  const current = new MigrationClient({ version: 6, checksum: schemaChecksum });
  assert.deepEqual(await schemaStatus(current), { state: 'current', version: 6 });
  await requireSchema(current);
  await assert.rejects(requireSchema(new MigrationClient({ version: 6, checksum: schemaChecksum, cloud: true })), /Cloud database cannot be served/);
  await assert.rejects(requireSchema(new MigrationClient()), /automatic upgrades are disabled/);
});

test('schema 3 migration is transactional and creates bounded enrollment rendezvous', async () => {
  const client = new MigrationClient({ version: 2, checksum: schemaV2Checksum });
  assert.deepEqual(await migrateSchema2To3(client), { from: 2, to: 3, dryRun: false });
  assert.ok(schemaV3MigrationSql.includes('poll_token_digest bytea NOT NULL'));
  assert.ok(schemaV3MigrationSql.includes('proposed_signing_public_key bytea NOT NULL'));
  assert.equal(client.calls.at(-2).parameters[0], schemaV3Checksum);
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
});

test('schema 4 migration permits multiple vaults without changing item rows', async () => {
  const client = new MigrationClient({ version: 3, checksum: schemaV3Checksum });
  assert.deepEqual(await migrateSchema3To4(client), { from: 3, to: 4, dryRun: false });
  assert.ok(schemaV4MigrationSql.includes('DROP CONSTRAINT private_vaults_tenant_id_account_id_key'));
  assert.equal(client.calls.at(-2).parameters[0], schemaV4Checksum);
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
});

test('schema 5 migration adds opaque account settings without changing vault rows', async () => {
  const client = new MigrationClient({ version: 4, checksum: schemaV4Checksum });
  assert.deepEqual(await migrateSchema4To5(client), { from: 4, to: 5, dryRun: false });
  assert.ok(schemaV5MigrationSql.includes('envelope bytea NOT NULL'));
  assert.equal(client.calls.at(-2).parameters[0], schemaV5Checksum);
});

test('schema 6 migration adds recoverable retirement without changing vault or item rows', async () => {
  const client = new MigrationClient({ version: 5, checksum: schemaV5Checksum });
  assert.deepEqual(await migrateSchema5To6(client), { from: 5, to: 6, dryRun: false });
  assert.ok(schemaV6MigrationSql.includes('retirement_choice'));
  assert.ok(schemaV6MigrationSql.includes('private_vault_move_items'));
  assert.equal(client.calls.at(-2).parameters[0], schemaChecksum);
});

test('DDL retains bounded cryptographic fields, idempotency, FKs, and legacy backfill', () => {
  for (const fragment of [
    'octet_length(proposed_signing_public_key)=32',
    'octet_length(signature)=64',
    'UNIQUE (tenant_id,vault_id,operation_id)',
    'REFERENCES vaults.private_vaults(tenant_id,id)',
    'credential_epoch_seen = credential_epoch',
    "ADD COLUMN active boolean GENERATED ALWAYS AS (lifecycle_status = 'active') STORED",
    'INSERT INTO vaults.sync_vault_state',
    "CHECK (state IN ('healthy','frozen','integrity_error'))"
  ]) assert.ok(schemaV2MigrationSql.includes(fragment), fragment);
});

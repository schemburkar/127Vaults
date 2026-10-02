import { schemaChecksum, schemaV1Checksum, schemaV2Checksum, schemaV2MigrationSql, schemaV3MigrationSql } from './schema.mjs';

const MANIFEST_ERROR = 'Unknown or changed schema; migration refused.';
const countsSql = `SELECT
  (SELECT count(*)::bigint FROM vaults.accounts) accounts,
  (SELECT count(*)::bigint FROM vaults.devices) devices,
  (SELECT count(*)::bigint FROM vaults.sessions) sessions,
  (SELECT count(*)::bigint FROM vaults.private_vaults) vaults,
  (SELECT count(*)::bigint FROM vaults.private_items) items`;

export async function schemaStatus(client) {
  const installed = (await client.query("SELECT to_regclass('vaults.schema_version') AS relation")).rows[0]?.relation;
  if (!installed) return { state: 'uninitialized' };
  const result = await client.query('SELECT version, checksum FROM vaults.schema_version');
  if (result.rowCount !== 1) return { state: 'unknown' };
  const { version, checksum } = result.rows[0];
  if (Number(version) === 1 && checksum === schemaV1Checksum) return { state: 'migration-required', version: 1 };
  if (Number(version) === 2 && checksum === schemaV2Checksum) return { state: 'migration-required', version: 2 };
  if (Number(version) === 3 && checksum === schemaChecksum) return { state: 'current', version: 3 };
  return { state: 'unknown', version: Number(version) };
}

async function validateV2(client, before) {
  const after = (await client.query(countsSql)).rows[0];
  for (const name of ['accounts','devices','sessions','vaults','items']) {
    if (String(after[name]) !== String(before[name])) throw new Error('Schema migration row-count validation failed.');
  }
  const invalid = await client.query(`SELECT
    (SELECT count(*) FROM vaults.devices WHERE credential_epoch_seen IS NULL OR active <> (lifecycle_status='active')) +
    (SELECT count(*) FROM vaults.sessions s LEFT JOIN vaults.devices d
      ON (d.tenant_id=s.tenant_id AND d.account_id=s.account_id AND d.id=s.device_id) WHERE d.id IS NULL) AS count`);
  if (Number(invalid.rows[0].count) !== 0) throw new Error('Schema migration invariant validation failed.');
}

export async function migrateSchema1To2(client, { dryRun = false } = {}) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(127, 1)');
    const manifest = await client.query('SELECT version, checksum FROM vaults.schema_version FOR UPDATE');
    if (manifest.rowCount !== 1 || Number(manifest.rows[0].version) !== 1 || manifest.rows[0].checksum !== schemaV1Checksum) {
      throw new Error(MANIFEST_ERROR);
    }
    const before = (await client.query(countsSql)).rows[0];
    await client.query(schemaV2MigrationSql);
    await validateV2(client, before);
    // Manifest is deliberately the final write in the migration transaction.
    await client.query('UPDATE vaults.schema_version SET version=2, checksum=$1 WHERE singleton=true', [schemaV2Checksum]);
    if (dryRun) await client.query('ROLLBACK');
    else await client.query('COMMIT');
    return { from: 1, to: 2, dryRun };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function migrateSchema2To3(client, { dryRun = false } = {}) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(127, 1)');
    const manifest = await client.query('SELECT version, checksum FROM vaults.schema_version FOR UPDATE');
    if (manifest.rowCount !== 1 || Number(manifest.rows[0].version) !== 2 || manifest.rows[0].checksum !== schemaV2Checksum) throw new Error(MANIFEST_ERROR);
    const before = (await client.query(countsSql)).rows[0];
    await client.query(schemaV3MigrationSql);
    const after = (await client.query(countsSql)).rows[0];
    for (const name of ['accounts','devices','sessions','vaults','items']) if (String(after[name]) !== String(before[name])) throw new Error('Schema migration row-count validation failed.');
    await client.query('UPDATE vaults.schema_version SET version=3, checksum=$1 WHERE singleton=true', [schemaChecksum]);
    if (dryRun) await client.query('ROLLBACK'); else await client.query('COMMIT');
    return { from: 2, to: 3, dryRun };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}

export { MANIFEST_ERROR };

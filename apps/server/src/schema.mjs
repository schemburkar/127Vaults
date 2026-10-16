import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const normalize = value => value.replaceAll('\r\n', '\n');
const sha256 = value => createHash('sha256').update(normalize(value)).digest('hex');

export const schemaV1Sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
export const schemaV1Checksum = '1cb04ec65b704943dffa1c0af9086f1a5baa0327f5719cb28fa307c1a06f3c02';
if (sha256(schemaV1Sql) !== schemaV1Checksum) {
  throw new Error('Frozen schema 1 source has changed.');
}
export const schemaV2MigrationSql = await readFile(new URL('./schema-v2-migration.sql', import.meta.url), 'utf8');
export const schemaV2Checksum = sha256(`${normalize(schemaV1Sql)}\n-- schema-2-boundary\n${normalize(schemaV2MigrationSql)}`);
export const schemaV3MigrationSql = await readFile(new URL('./schema-v3-migration.sql', import.meta.url), 'utf8');
export const schemaV3Checksum = sha256(`${normalize(schemaV1Sql)}\n-- schema-2-boundary\n${normalize(schemaV2MigrationSql)}\n-- schema-3-boundary\n${normalize(schemaV3MigrationSql)}`);
export const schemaV4MigrationSql = await readFile(new URL('./schema-v4-migration.sql', import.meta.url), 'utf8');
export const schemaV4Checksum = sha256(`${normalize(schemaV1Sql)}\n-- schema-2-boundary\n${normalize(schemaV2MigrationSql)}\n-- schema-3-boundary\n${normalize(schemaV3MigrationSql)}\n-- schema-4-boundary\n${normalize(schemaV4MigrationSql)}`);
export const schemaV5MigrationSql = await readFile(new URL('./schema-v5-migration.sql', import.meta.url), 'utf8');
export const schemaV5Checksum = sha256(`${normalize(schemaV1Sql)}\n-- schema-2-boundary\n${normalize(schemaV2MigrationSql)}\n-- schema-3-boundary\n${normalize(schemaV3MigrationSql)}\n-- schema-4-boundary\n${normalize(schemaV4MigrationSql)}\n-- schema-5-boundary\n${normalize(schemaV5MigrationSql)}`);
export const schemaV6MigrationSql = await readFile(new URL('./schema-v6-migration.sql', import.meta.url), 'utf8');
const schemaV6Recipe = `${normalize(schemaV1Sql)}\n-- schema-2-boundary\n${normalize(schemaV2MigrationSql)}\n-- schema-3-boundary\n${normalize(schemaV3MigrationSql)}\n-- schema-4-boundary\n${normalize(schemaV4MigrationSql)}\n-- schema-5-boundary\n${normalize(schemaV5MigrationSql)}\n-- schema-6-boundary\n${normalize(schemaV6MigrationSql)}`;
export const schemaV6Checksum = sha256(schemaV6Recipe);
export const schemaV7MigrationSql = await readFile(new URL('./schema-v7-migration.sql', import.meta.url), 'utf8');
const schemaV7Recipe = `${schemaV6Recipe}\n-- schema-7-boundary\n${normalize(schemaV7MigrationSql)}`;
export const schemaV7Checksum = sha256(schemaV7Recipe);
export const schemaV8MigrationSql = await readFile(new URL('./schema-v8-migration.sql', import.meta.url), 'utf8');
export const schemaChecksum = sha256(`${schemaV7Recipe}\n-- schema-8-boundary\n${normalize(schemaV8MigrationSql)}`);
export const schemaVersion = 8;
export const schemaSql = `${schemaV1Sql}\n${schemaV2MigrationSql}\n${schemaV3MigrationSql}\n${schemaV4MigrationSql}\n${schemaV5MigrationSql}\n${schemaV6MigrationSql}\n${schemaV7MigrationSql}\n${schemaV8MigrationSql}`;

export async function requireSchema(client) {
  const result = await client.query('SELECT version, checksum FROM vaults.schema_version');
  if (result.rowCount !== 1 || Number(result.rows[0].version) !== schemaVersion || result.rows[0].checksum !== schemaChecksum) {
    throw new Error('Unknown or changed schema; automatic upgrades are disabled.');
  }
  const cloud = await client.query("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='cloud') AS present");
  if (cloud.rows[0]?.present) throw new Error('Cloud database cannot be served by the self-hosted server.');
}

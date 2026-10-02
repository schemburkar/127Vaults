import pg from 'pg';
import { runtimeDatabaseConfig } from './runtime-config.mjs';
import { migrateSchema1To2, migrateSchema2To3, migrateSchema3To4, migrateSchema4To5, schemaStatus } from './schema-migration.mjs';

export async function runMigration(action) {
const fail = message => { throw new Error(message); };
if (process.env.VAULTS_EXPERIMENTAL !== '1') fail('Experimental opt-in required.');
if (!['status','dry-run','apply'].includes(action)) fail('Choose status, dry-run, or apply.');
const client = new pg.Client({ ...runtimeDatabaseConfig(process.env), connectionTimeoutMillis: 3000, statement_timeout: 30000 });
try {
  await client.connect();
  let result;
  if (action === 'status') result = await schemaStatus(client);
  else {
    const state = await schemaStatus(client);
    result = state.version === 1
      ? await migrateSchema1To2(client, { dryRun: action === 'dry-run' })
      : state.version === 2
        ? await migrateSchema2To3(client, { dryRun: action === 'dry-run' })
        : state.version === 3
          ? await migrateSchema3To4(client, { dryRun: action === 'dry-run' })
          : await migrateSchema4To5(client, { dryRun: action === 'dry-run' });
  }
  console.log(JSON.stringify({ experimental: true, action, ...result }));
} catch (error) {
  const safe = new Set([
    'Unknown or changed schema; migration refused.',
    'Schema migration row-count validation failed.',
    'Schema migration invariant validation failed.',
    'Database password file is required.', 'Database password file must be readable.',
    'Database password file must be a regular file.', 'Database password file permissions are too broad.',
    'Database password file is malformed.'
  ]);
  console.error(safe.has(error.message) ? error.message : 'Schema migration failed. No changes committed.');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
}

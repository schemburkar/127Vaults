import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { schemaSql, schemaChecksum, schemaVersion, requireSchema } from './schema.mjs';
import { tokenDigest } from './onboarding.mjs';
import { runtimeDatabaseConfig } from './runtime-config.mjs';
import { loadLicenseStatus } from './license-status.mjs';
import { LicenseClock } from './license-clock.mjs';
import { readSeatUsage } from './license-seats.mjs';

async function inspectLicense(installationId) {
  if (process.env.VAULTS_LICENSE_FILE && !process.env.VAULTS_LICENSE_CLOCK_FILE) throw Error('license_clock_unavailable');
  const clock = process.env.VAULTS_LICENSE_CLOCK_FILE ? new LicenseClock(process.env.VAULTS_LICENSE_CLOCK_FILE) : null;
  return loadLicenseStatus({ licenseFile: process.env.VAULTS_LICENSE_FILE,
    publicKeyFile: process.env.VAULTS_LICENSE_PUBLIC_KEYS_FILE,
    revocationFile: process.env.VAULTS_LICENSE_REVOCATION_FILE, installationId, clock });
}

// Host-local installation and single-use owner bootstrap capability generation.
export async function runProvision(action) {
const reject = message => { throw new Error(message); };
if (process.env.VAULTS_EXPERIMENTAL !== '1') reject('Experimental opt-in required.');
if (!['initialize', 'create-bootstrap-token', 'status'].includes(action)) {
  reject('Choose initialize, create-bootstrap-token, or status.');
}
const input = {};
const client = new pg.Client({ ...runtimeDatabaseConfig(process.env), connectionTimeoutMillis: 3000,
  statement_timeout: 10000 });
try {
  await client.connect();
  await client.query('BEGIN');
  // Serializes initialization and provisioning across concurrent processes.
  await client.query('SELECT pg_advisory_xact_lock(127, 1)');
  const installed = (await client.query("SELECT to_regclass('vaults.schema_version') AS relation")).rows[0].relation;
  if (action === 'initialize' && !installed) {
    const existing = await client.query("SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public', 'information_schema') AND nspname NOT LIKE 'pg_%' UNION ALL SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' LIMIT 1");
    if (existing.rowCount) reject('Refusing non-empty database. Existing databases require verified backup/restore and a reviewed migration.');
    await client.query(schemaSql);
    await client.query('INSERT INTO vaults.schema_version(singleton, version, checksum) VALUES (true, $1, $2)', [schemaVersion, schemaChecksum]);
    await client.query('INSERT INTO vaults.installation(id) VALUES ($1)', [randomUUID()]);
  } else {
    if (!installed) reject('Schema is not initialized.');
    await requireSchema(client);
  }
  let bootstrapPlaintext;
  if (action === 'create-bootstrap-token') {
    const tenant = (await client.query('SELECT id FROM vaults.installation FOR UPDATE')).rows[0]?.id;
    if (!tenant) reject('Installation record missing.');
    if ((await client.query("SELECT 1 FROM vaults.accounts WHERE tenant_id=$1 AND server_role='owner'",[tenant])).rowCount) reject('Bootstrap is already closed.');
    const entitlement = await inspectLicense(tenant);
    if (!['active'].includes(entitlement.mode)) reject('Owner bootstrap requires an active signed license.');
    const keyPath=process.env.VAULTS_TOKEN_KEY_FILE, outputPath=process.env.VAULTS_BOOTSTRAP_OUTPUT;
    if (!keyPath || !outputPath) reject('Token key and bootstrap output paths are required.');
    const key=await readFile(keyPath); if(key.length!==32) reject('Token key must contain exactly 32 bytes.');
    const raw=randomBytes(32); bootstrapPlaintext=`127V-B1-${raw.toString('base64url')}`;
    await client.query(`INSERT INTO vaults.bootstrap_tokens(tenant_id,token_digest,expires_at,consumed_at) VALUES($1,$2,now()+interval '60 minutes',NULL)
      ON CONFLICT(tenant_id) DO UPDATE SET token_digest=excluded.token_digest,expires_at=excluded.expires_at,consumed_at=NULL,created_at=now()`,[tenant,tokenDigest(key,'bootstrap',raw)]);
    input.bootstrapOutputPath=outputPath;
  }
  const installationId = (await client.query('SELECT id FROM vaults.installation WHERE singleton=true')).rows[0]?.id;
  if (!installationId) reject('Installation record missing.');
  const counts = (await client.query("SELECT count(*)::int AS pending_accounts, count(*) FILTER (WHERE server_role='owner')::int AS provisional_owners FROM vaults.accounts")).rows[0];
  const invitations = (await client.query('SELECT count(*) FILTER (WHERE expires_at > now())::int AS unexpired_invitation_records, count(*) FILTER (WHERE expires_at <= now())::int AS expired_invitation_records FROM vaults.invitation_records')).rows[0];
  const seatUsage = action === 'status' ? await readSeatUsage(client, installationId, new Date()) : null;
  await client.query('COMMIT');
  if (bootstrapPlaintext) await writeFile(input.bootstrapOutputPath,`${bootstrapPlaintext}\n`,{encoding:'ascii',mode:0o600,flag:'w'});
  if (action === 'status' && process.env.VAULTS_BOOTSTRAP_OUTPUT) {
    const active=(await client.query('SELECT 1 FROM vaults.bootstrap_tokens WHERE consumed_at IS NULL AND expires_at>now()')).rowCount;
    if (!active) await unlink(process.env.VAULTS_BOOTSTRAP_OUTPUT).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  let license;
  if (action === 'status') {
    try { license = await inspectLicense(installationId); }
    catch { license = { mode: 'unavailable', clockState: 'unavailable' }; }
  }
  console.log(JSON.stringify({ experimental: true, schemaVersion, installationId, action, ...counts,
    ...invitations, bootstrapRequired: counts.provisional_owners === 0,
    ...(seatUsage ? { seatUsage, license: { mode: license.mode, plan: license.plan ?? null,
      maxActiveUsers: license.maxActiveUsers ?? null, expiresAt: license.expiresAt ?? null,
      readOnlyUntil: license.readOnlyUntil ?? null, revokedAt: license.revokedAt ?? null,
      clockState: license.clockState ?? 'not_applicable' } } : {}),
    authenticationAvailable: true, bootstrapTokenWritten: Boolean(bootstrapPlaintext), nextStep: counts.provisional_owners === 0
      ? 'Retrieve the restricted bootstrap file locally and complete HTTPS onboarding within 60 minutes.'
      : 'Use authenticated owner invitation creation.' }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  // Never echo SQL values, URLs, or user-supplied identity data.
  const safeMessages = ['Refusing non-empty database. Existing databases require verified backup/restore and a reviewed migration.', 'Schema is not initialized.', 'Unknown or changed schema; automatic upgrades are disabled.', 'Installation record missing.', 'Bootstrap is already closed.', 'Owner bootstrap requires an active signed license.', 'Token key and bootstrap output paths are required.', 'Token key must contain exactly 32 bytes.', 'Database password file is required.', 'Database password file must be readable.', 'Database password file must be a regular file.', 'Database password file permissions are too broad.', 'Database password file is malformed.'];
  console.error(safeMessages.includes(error.message) ? error.message : `Provisioning failed${error.code === '23505' ? ': duplicate identity' : ''}. No changes committed.`);
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
}

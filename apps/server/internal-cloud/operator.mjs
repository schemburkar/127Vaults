import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tokenDigest } from '../src/onboarding.mjs';
import { cloudTenantDirectory } from '../src/tenant-context.mjs';
import { schemaChecksum, schemaSql, schemaVersion } from '../src/schema.mjs';
import pg from 'pg';

export const overlaySql = await readFile(new URL('./overlay.sql', import.meta.url), 'utf8');
export const overlayChecksum = createHash('sha256').update(overlaySql.replaceAll('\r\n', '\n')).digest('hex');

const invalid = message => { throw new Error(message); };
const regionValid = region => /^[a-z][a-z0-9-]{1,31}$/.test(region ?? '');
const uuidValid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value ?? '');

async function transaction(client, action) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query('SELECT pg_advisory_xact_lock(127, 20)');
    const value = await action();
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function initializeCloudDatabase(client, region, { allowInitialized = false } = {}) {
  if (!regionValid(region)) invalid('Invalid region.');
  return transaction(client, async () => {
    if (allowInitialized && (await client.query("SELECT to_regclass('cloud.schema_manifest') AS manifest")).rows[0].manifest) {
      return { ...(await verifyCloudDatabase(client, region)), initialized: false };
    }
    const occupied = await client.query(`SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public', 'information_schema') AND nspname NOT LIKE 'pg_%'
      UNION ALL SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' LIMIT 1`);
    if (occupied.rowCount) invalid('Regional Cloud database must be empty.');
    await client.query(schemaSql);
    await client.query('INSERT INTO vaults.schema_version(singleton,version,checksum) VALUES(true,$1,$2)', [schemaVersion, schemaChecksum]);
    await client.query(overlaySql);
    await client.query('INSERT INTO cloud.schema_manifest(singleton,version,region,base_checksum,overlay_checksum) VALUES(true,1,$1,$2,$3)', [region, schemaChecksum, overlayChecksum]);
    await client.query('SELECT cloud.verify_rls()');
    return { region, schemaVersion, overlayChecksum, initialized: true };
  });
}

export async function verifyCloudDatabase(client, region) {
  if (!regionValid(region)) invalid('Invalid region.');
  const manifest = (await client.query(`SELECT c.version,c.region,c.base_checksum,c.overlay_checksum,s.version AS base_version,s.checksum AS installed_base_checksum
    FROM cloud.schema_manifest c CROSS JOIN vaults.schema_version s`)).rows;
  if (manifest.length !== 1 || manifest[0].version !== 1 || manifest[0].region !== region ||
      manifest[0].base_checksum !== schemaChecksum || manifest[0].overlay_checksum !== overlayChecksum ||
      Number(manifest[0].base_version) !== schemaVersion || manifest[0].installed_base_checksum !== schemaChecksum) {
    invalid('Unknown or changed regional Cloud schema.');
  }
  const roles = (await client.query(`SELECT r.rolname,r.rolcanlogin,r.rolbypassrls,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,
    EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS inherits_role
    FROM pg_roles r WHERE r.rolname IN ('vaults_cloud_runtime','vaults_cloud_directory_owner')`)).rows;
  if (roles.length !== 2 || roles.some(role => role.rolcanlogin || role.rolbypassrls || role.rolsuper ||
      role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.inherits_role)) {
    invalid('Unsafe regional Cloud runtime role.');
  }
  const directory = (await client.query(`SELECT has_function_privilege('vaults_cloud_runtime','cloud.resolve_tenant(text,text)','EXECUTE') AS can_resolve,
    has_table_privilege('vaults_cloud_runtime','cloud.tenants','SELECT') AS can_list,
    pg_get_userbyid(p.proowner) AS function_owner FROM pg_proc p WHERE p.oid='cloud.resolve_tenant(text,text)'::regprocedure`)).rows[0];
  if (!directory?.can_resolve || directory.can_list || directory.function_owner !== 'vaults_cloud_directory_owner') {
    invalid('Unsafe regional Cloud directory access.');
  }
  const prepared = (await client.query(`SELECT has_function_privilege('vaults_cloud_runtime','cloud.resolve_prepared_tenant(text,text)','EXECUTE') AS can_resolve,
    pg_get_userbyid(p.proowner) AS function_owner FROM pg_proc p WHERE p.oid='cloud.resolve_prepared_tenant(text,text)'::regprocedure`)).rows[0];
  if (!prepared?.can_resolve || prepared.function_owner !== 'vaults_cloud_directory_owner') {
    invalid('Unsafe Cloud enrollment directory access.');
  }
  await client.query('SELECT cloud.verify_rls()');
  return { region, schemaVersion, overlayChecksum };
}

export async function ensureCloudRuntimeLogin(client, { user, password }) {
  if (!/^vaults_cloud_login_[a-z0-9_]{1,40}$/.test(user ?? '') || !/^[a-f0-9]{64}$/.test(password ?? '')) {
    invalid('Dedicated Cloud runtime login and password required.');
  }
  return transaction(client, async () => {
    const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [user])).rowCount > 0;
    if (exists) return { runtimeUser: user, created: false };
    const role = pg.escapeIdentifier(user);
    await client.query("SET LOCAL password_encryption = 'scram-sha-256'");
    await client.query(`CREATE ROLE ${role} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${pg.escapeLiteral(password)}`);
    await client.query(`GRANT vaults_cloud_runtime TO ${role}`);
    return { runtimeUser: user, created: true };
  });
}

export async function reserveCloudTenant(client, { region, host, maxActiveUsers }) {
  if (!regionValid(region) || typeof host !== 'string' || host !== host.toLowerCase()) invalid('Invalid tenant reservation.');
  // Reuse the request resolver's exact identity validation before any write.
  cloudTenantDirectory([{ id: randomUUID(), host, region, state: 'reserved' }], region);
  if (!Number.isInteger(maxActiveUsers) || maxActiveUsers < 1 || maxActiveUsers > 2147483647) invalid('Valid Cloud seat limit required.');
  return transaction(client, async () => {
    await verifyCloudDatabase(client, region);
    const existing = (await client.query('SELECT id,region,host,state,max_active_users FROM cloud.tenants WHERE host=$1 FOR UPDATE', [host])).rows[0];
    if (existing) {
      if (existing.region !== region || existing.state !== 'reserved' || existing.max_active_users !== maxActiveUsers) invalid('Tenant reservation conflicts with existing state.');
      return { id: existing.id, region, host, maxActiveUsers, state: existing.state, reused: true };
    }
    const id = randomUUID();
    await client.query('INSERT INTO vaults.installation(id) VALUES($1)', [id]);
    await client.query('INSERT INTO cloud.tenants(id,region,host,max_active_users) VALUES($1,$2,$3,$4)', [id, region, host, maxActiveUsers]);
    return { id, region, host, maxActiveUsers, state: 'reserved', reused: false };
  });
}

// This links an identity already verified by the separate customer control
// plane. It grants no vault access and never counts as a vault seat.
export async function linkCloudControlOwner(client, { region, host, ownerIdentityId, ownerEmail }) {
  if (!regionValid(region) || !uuidValid(ownerIdentityId) || typeof ownerEmail !== 'string' ||
      ownerEmail.length < 3 || ownerEmail.length > 254 || ownerEmail !== ownerEmail.toLowerCase() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) invalid('Valid verified Cloud control owner required.');
  cloudTenantDirectory([{ id: randomUUID(), host, region, state: 'reserved' }], region);
  return transaction(client, async () => {
    await verifyCloudDatabase(client, region);
    const tenant = (await client.query('SELECT id,state,control_owner_id,control_owner_email FROM cloud.tenants WHERE region=$1 AND host=$2 FOR UPDATE', [region, host])).rows[0];
    if (!tenant || !['reserved', 'prepared'].includes(tenant.state)) invalid('Cloud control owner cannot be linked in this state.');
    if (tenant.control_owner_id && (tenant.control_owner_id !== ownerIdentityId || tenant.control_owner_email !== ownerEmail)) {
      invalid('Cloud control owner already linked to another identity.');
    }
    if (!tenant.control_owner_id) await client.query('UPDATE cloud.tenants SET control_owner_id=$2,control_owner_email=$3 WHERE id=$1',
      [tenant.id, ownerIdentityId, ownerEmail]);
    return { id: tenant.id, region, host, controlOwnerId: ownerIdentityId, reused: Boolean(tenant.control_owner_id) };
  });
}

// Operator-only lifecycle. The database transaction makes each transition
// atomic; the API role has no grant on the directory or these writes.
export async function prepareCloudTenant(client, { region, host, setupBytes }) {
  if (!regionValid(region) || !Buffer.isBuffer(setupBytes) || setupBytes.length < 96 || setupBytes.length > 512) {
    invalid('Valid Cloud tenant setup required.');
  }
  cloudTenantDirectory([{ id: randomUUID(), host, region, state: 'reserved' }], region);
  return transaction(client, async () => {
    await verifyCloudDatabase(client, region);
    const tenant = (await client.query('SELECT id,state FROM cloud.tenants WHERE region=$1 AND host=$2 FOR UPDATE', [region, host])).rows[0];
    if (!tenant || !['reserved', 'prepared'].includes(tenant.state)) invalid('Tenant is not reservable for preparation.');
    const existing = (await client.query('SELECT setup_bytes FROM vaults.opaque_server_setup WHERE tenant_id=$1', [tenant.id])).rows[0];
    if (existing && !existing.setup_bytes.equals(setupBytes)) invalid('Cloud tenant setup already exists with different identity.');
    if (!existing) await client.query('INSERT INTO vaults.opaque_server_setup(tenant_id,setup_bytes) VALUES($1,$2)', [tenant.id, setupBytes]);
    if (tenant.state === 'reserved') await client.query("UPDATE cloud.tenants SET state='prepared' WHERE id=$1", [tenant.id]);
    return { id: tenant.id, host, region, state: 'prepared', reused: Boolean(existing) };
  });
}

export async function issueCloudBootstrapToken(client, { region, host, tokenKey }) {
  if (!regionValid(region) || !Buffer.isBuffer(tokenKey) || tokenKey.length !== 32) invalid('Valid Cloud bootstrap key required.');
  cloudTenantDirectory([{ id: randomUUID(), host, region, state: 'reserved' }], region);
  return transaction(client, async () => {
    await verifyCloudDatabase(client, region);
    const tenant = (await client.query('SELECT id,state FROM cloud.tenants WHERE region=$1 AND host=$2 FOR UPDATE', [region, host])).rows[0];
    if (!tenant || tenant.state !== 'prepared') invalid('Cloud tenant must be prepared before owner bootstrap.');
    if ((await client.query("SELECT 1 FROM vaults.accounts WHERE tenant_id=$1 AND server_role='owner'", [tenant.id])).rowCount) {
      invalid('Cloud tenant owner already exists.');
    }
    const raw = randomBytes(32);
    await client.query(`INSERT INTO vaults.bootstrap_tokens(tenant_id,token_digest,expires_at,consumed_at)
      VALUES($1,$2,now()+interval '60 minutes',NULL)
      ON CONFLICT(tenant_id) DO UPDATE SET token_digest=excluded.token_digest,expires_at=excluded.expires_at,
        consumed_at=NULL,created_at=now()`, [tenant.id, tokenDigest(tokenKey, 'bootstrap', raw)]);
    return { id: tenant.id, host, region, token: `127V-B1-${raw.toString('base64url')}` };
  });
}

export async function activateCloudTenant(client, { region, host }) {
  if (!regionValid(region) || typeof host !== 'string') invalid('Invalid tenant activation.');
  cloudTenantDirectory([{ id: randomUUID(), host, region, state: 'reserved' }], region);
  return transaction(client, async () => {
    await verifyCloudDatabase(client, region);
    const tenant = (await client.query('SELECT id,state,control_owner_id FROM cloud.tenants WHERE region=$1 AND host=$2 FOR UPDATE', [region, host])).rows[0];
    if (!tenant || !['prepared', 'active'].includes(tenant.state)) invalid('Tenant is not prepared for activation.');
    if (!tenant.control_owner_id) invalid('Verified Cloud control owner is required.');
    const ready = (await client.query(`SELECT EXISTS(SELECT 1 FROM vaults.opaque_server_setup WHERE tenant_id=$1) AS setup,
      EXISTS(SELECT 1 FROM vaults.bootstrap_tokens WHERE tenant_id=$1 AND consumed_at IS NOT NULL) AS bootstrap,
      EXISTS(SELECT 1 FROM vaults.accounts a JOIN vaults.authentication_credentials c ON c.tenant_id=a.tenant_id AND c.account_id=a.id
        JOIN vaults.devices d ON d.tenant_id=a.tenant_id AND d.account_id=a.id AND d.active
        WHERE a.tenant_id=$1 AND a.server_role='owner' AND a.enrollment_state='active') AS owner`, [tenant.id])).rows[0];
    if (!ready?.setup || !ready?.bootstrap || !ready?.owner) invalid('Cloud tenant owner enrollment is incomplete.');
    if (tenant.state === 'prepared') await client.query("UPDATE cloud.tenants SET state='active',activated_at=now() WHERE id=$1", [tenant.id]);
    return { id: tenant.id, host, region, state: 'active', reused: tenant.state === 'active' };
  });
}

-- Internal Cloud overlay for a NEW, empty regional database only.
-- This file is deliberately outside apps/server/src and is not copied into
-- the self-hosted server image. It is applied by the internal operator tool.
CREATE SCHEMA cloud;

CREATE TABLE cloud.schema_manifest (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL CHECK (version = 1),
  region text COLLATE "C" NOT NULL UNIQUE CHECK (region ~ '^[a-z][a-z0-9-]{1,31}$'),
  base_checksum text NOT NULL CHECK (base_checksum ~ '^[a-f0-9]{64}$'),
  overlay_checksum text NOT NULL CHECK (overlay_checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The base schema's singleton installation is valid only for self-hosting.
ALTER TABLE vaults.installation DROP COLUMN singleton;

-- The installation server rate limiter is global. Cloud gives it a tenant key
-- so one tenant cannot consume another's onboarding budget.
ALTER TABLE vaults.onboarding_rate_limits ADD COLUMN tenant_id uuid NOT NULL REFERENCES vaults.installation(id);
ALTER TABLE vaults.onboarding_rate_limits DROP CONSTRAINT onboarding_rate_limits_pkey;
ALTER TABLE vaults.onboarding_rate_limits ADD PRIMARY KEY (tenant_id,attempt_id);

-- Installation-wide audit sequences expose cross-tenant activity counts to a
-- role that can insert audit rows. Use random tenant-scoped audit IDs instead.
ALTER TABLE vaults.private_audit DROP CONSTRAINT private_audit_pkey;
ALTER TABLE vaults.private_audit DROP COLUMN id;
ALTER TABLE vaults.private_audit ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE vaults.private_audit ADD PRIMARY KEY (tenant_id,id);
ALTER TABLE vaults.device_lifecycle_audit DROP CONSTRAINT device_lifecycle_audit_pkey;
ALTER TABLE vaults.device_lifecycle_audit DROP COLUMN id;
ALTER TABLE vaults.device_lifecycle_audit ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE vaults.device_lifecycle_audit ADD PRIMARY KEY (tenant_id,id);
DROP FUNCTION vaults.reserve_onboarding_attempt(text,timestamptz,uuid);
CREATE FUNCTION vaults.reserve_onboarding_attempt(p_tenant uuid,p_source text,p_now timestamptz,p_attempt uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog AS $reserve$
BEGIN
  IF p_tenant IS NULL OR p_source IS NULL OR octet_length(p_source)>128 OR
     p_tenant::text IS DISTINCT FROM current_setting('vaults.tenant_id',true) THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(127,6);
  DELETE FROM vaults.onboarding_rate_limits WHERE tenant_id=p_tenant AND created_at<p_now-interval '1 hour';
  IF (SELECT count(*) FROM vaults.onboarding_rate_limits WHERE tenant_id=p_tenant AND created_at>=p_now-interval '1 hour')>=100 OR
     (SELECT count(*) FROM vaults.onboarding_rate_limits WHERE tenant_id=p_tenant AND source=p_source AND created_at>=p_now-interval '10 minutes')>=10 THEN RETURN false; END IF;
  INSERT INTO vaults.onboarding_rate_limits(tenant_id,source,attempt_id,created_at) VALUES(p_tenant,p_source,p_attempt,p_now);
  RETURN true;
END $reserve$;

CREATE TABLE cloud.tenants (
  id uuid PRIMARY KEY REFERENCES vaults.installation(id) ON DELETE RESTRICT,
  region text COLLATE "C" NOT NULL REFERENCES cloud.schema_manifest(region),
  host text COLLATE "C" NOT NULL UNIQUE CHECK (char_length(host)<=253 AND host ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  control_owner_id uuid,
  max_active_users integer NOT NULL CHECK (max_active_users > 0),
  control_owner_email text COLLATE "C" CHECK (control_owner_email IS NULL OR (char_length(control_owner_email) BETWEEN 3 AND 254 AND control_owner_email = lower(control_owner_email))),
  state text COLLATE "C" NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','prepared','active','suspended','deleting')),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  CHECK (state <> 'active' OR activated_at IS NOT NULL),
  CHECK ((control_owner_id IS NULL) = (control_owner_email IS NULL)),
  CHECK (state <> 'active' OR control_owner_id IS NOT NULL),
  CHECK (state <> 'reserved' OR (activated_at IS NULL AND suspended_at IS NULL))
);
CREATE INDEX cloud_tenants_region_state ON cloud.tenants(region,state);

DO $directory_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vaults_cloud_directory_owner') THEN
    CREATE ROLE vaults_cloud_directory_owner NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles r WHERE rolname='vaults_cloud_directory_owner' AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)) THEN
    RAISE EXCEPTION 'Unsafe Cloud directory role';
  END IF;
END $directory_role$;
GRANT USAGE ON SCHEMA cloud TO vaults_cloud_directory_owner;
GRANT SELECT ON cloud.tenants TO vaults_cloud_directory_owner;

-- The future API role can resolve an active canonical hostname, but cannot
-- enumerate or modify the operator catalog. The fixed search path prevents a
-- caller from replacing objects used by this SECURITY DEFINER function.
CREATE FUNCTION cloud.resolve_tenant(p_host text,p_region text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $lookup$
  SELECT t.id FROM cloud.tenants AS t
  WHERE t.host=p_host AND t.region=p_region AND t.state='active'
$lookup$;
ALTER FUNCTION cloud.resolve_tenant(text,text) OWNER TO vaults_cloud_directory_owner;
REVOKE ALL ON FUNCTION cloud.resolve_tenant(text,text) FROM PUBLIC;

-- First-owner registration is allowed while the tenant remains invisible to
-- ordinary API traffic. Its caller must restrict the HTTP path to registration.
CREATE FUNCTION cloud.resolve_prepared_tenant(p_host text,p_region text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $lookup$
  SELECT t.id FROM cloud.tenants AS t
  WHERE t.host=p_host AND t.region=p_region AND t.state='prepared'
$lookup$;
ALTER FUNCTION cloud.resolve_prepared_tenant(text,text) OWNER TO vaults_cloud_directory_owner;
REVOKE ALL ON FUNCTION cloud.resolve_prepared_tenant(text,text) FROM PUBLIC;

CREATE FUNCTION cloud.enrollment_seat_limit(p_tenant uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $lookup$
  SELECT t.max_active_users FROM cloud.tenants AS t
  WHERE t.id=p_tenant AND t.id=nullif(current_setting('vaults.tenant_id', true), '')::uuid
    AND t.state IN ('prepared', 'active')
$lookup$;
ALTER FUNCTION cloud.enrollment_seat_limit(uuid) OWNER TO vaults_cloud_directory_owner;
REVOKE ALL ON FUNCTION cloud.enrollment_seat_limit(uuid) FROM PUBLIC;

-- The role has no login credential. A future reviewed deployment must grant
-- it to a separate, non-owner login role; never to the schema/migration owner.
DO $cloud_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vaults_cloud_runtime') THEN
    CREATE ROLE vaults_cloud_runtime NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles r WHERE rolname='vaults_cloud_runtime' AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)) THEN
    RAISE EXCEPTION 'Unsafe Cloud runtime role';
  END IF;
END $cloud_role$;
GRANT USAGE ON SCHEMA vaults TO vaults_cloud_runtime;
GRANT USAGE ON SCHEMA cloud TO vaults_cloud_runtime;
GRANT SELECT ON cloud.schema_manifest TO vaults_cloud_runtime;
GRANT EXECUTE ON FUNCTION cloud.resolve_tenant(text,text) TO vaults_cloud_runtime;
GRANT EXECUTE ON FUNCTION cloud.resolve_prepared_tenant(text,text) TO vaults_cloud_runtime;
GRANT EXECUTE ON FUNCTION cloud.enrollment_seat_limit(uuid) TO vaults_cloud_runtime;
GRANT SELECT ON vaults.schema_version TO vaults_cloud_runtime;

-- Every current base/migration table with tenant_id receives a fail-closed
-- policy. ALTER ... FORCE covers accidental table-owner access too. A later
-- migration must add its new tables before verify_rls can pass.
DO $cloud_rls$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'vaults' AND c.relkind = 'r'
      AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format('ALTER TABLE vaults.%I ENABLE ROW LEVEL SECURITY', item.table_name);
    EXECUTE format('ALTER TABLE vaults.%I FORCE ROW LEVEL SECURITY', item.table_name);
    EXECUTE format(
      'CREATE POLICY cloud_tenant_scope ON vaults.%I FOR ALL TO vaults_cloud_runtime USING (tenant_id = nullif(current_setting(''vaults.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''vaults.tenant_id'', true), '''')::uuid)',
      item.table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON vaults.%I TO vaults_cloud_runtime', item.table_name);
  END LOOP;
END $cloud_rls$;

ALTER TABLE vaults.installation ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaults.installation FORCE ROW LEVEL SECURITY;
CREATE POLICY cloud_installation_scope ON vaults.installation FOR SELECT TO vaults_cloud_runtime
  USING (id = nullif(current_setting('vaults.tenant_id', true), '')::uuid);
GRANT SELECT ON vaults.installation TO vaults_cloud_runtime;

-- The check is run by the operator before every migration and release. It
-- rejects any tenant table added without RLS/force/policy, and any unexpected
-- tenantless table introduced into the vaults schema.
CREATE FUNCTION cloud.verify_rls() RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog AS $verify$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity,
      EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped) AS scoped,
      EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='cloud_tenant_scope') AS policy_present
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='vaults' AND c.relkind='r' AND c.relname NOT IN ('schema_version','installation')
  LOOP
    IF NOT item.scoped OR NOT item.relrowsecurity OR NOT item.relforcerowsecurity OR NOT item.policy_present THEN
      RAISE EXCEPTION 'Cloud tenant policy inventory is incomplete: %', item.table_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vaults' AND c.relname='installation' AND c.relrowsecurity AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'Cloud installation policy is incomplete';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vaults' AND c.relkind='S') THEN
    RAISE EXCEPTION 'Cloud vaults schema contains a shared sequence';
  END IF;
END $verify$;
REVOKE ALL ON FUNCTION cloud.verify_rls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cloud.verify_rls() TO vaults_cloud_runtime;

-- Schema 6 -> 7: internal control-plane management; no vault content changes.
ALTER TABLE vaults.schema_version DROP CONSTRAINT schema_version_version_check;
ALTER TABLE vaults.schema_version ADD CONSTRAINT schema_version_version_check CHECK (version IN (1,2,3,4,5,6,7));
ALTER TABLE vaults.accounts DROP CONSTRAINT accounts_server_role_check;
ALTER TABLE vaults.accounts ADD CONSTRAINT accounts_server_role_check CHECK (server_role IN ('owner','admin','user'));
ALTER TABLE vaults.accounts ADD COLUMN suspended_at timestamptz;
DROP INDEX vaults.one_provisional_owner;

CREATE TABLE vaults.ownership_grants (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  requested_by text NOT NULL CHECK (octet_length(requested_by) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  accepted_at timestamptz,
  applied_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,recipient_id) REFERENCES vaults.accounts(tenant_id,id),
  CHECK (expires_at > created_at),
  CHECK (applied_at IS NULL OR accepted_at IS NOT NULL)
);
CREATE UNIQUE INDEX ownership_grant_pending ON vaults.ownership_grants(tenant_id,recipient_id)
  WHERE accepted_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE vaults.admin_mutation_receipts (
  tenant_id uuid NOT NULL REFERENCES vaults.installation(id),
  request_id uuid NOT NULL,
  actor_id text NOT NULL CHECK (octet_length(actor_id) BETWEEN 1 AND 128),
  request_hash bytea NOT NULL CHECK (octet_length(request_hash)=32),
  result jsonb NOT NULL CHECK (octet_length(result::text) <= 8192),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,request_id)
);
CREATE TABLE vaults.admin_control_audit (
  tenant_id uuid NOT NULL REFERENCES vaults.installation(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id text NOT NULL CHECK (octet_length(actor_id) BETWEEN 1 AND 128),
  action text NOT NULL CHECK (octet_length(action) BETWEEN 1 AND 64),
  target_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('accepted','denied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id)
);

DROP TRIGGER protect_provisional_owner ON vaults.accounts;
DROP FUNCTION vaults.protect_provisional_owner();
CREATE FUNCTION vaults.protect_active_owners() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- All owner changes serialize, including changes submitted by concurrent sessions.
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.tenant_id::text,127));
  IF OLD.server_role='owner' AND OLD.enrollment_state='active' AND OLD.suspended_at IS NULL
     AND (TG_OP='DELETE' OR NEW.server_role<>'owner' OR NEW.enrollment_state<>'active' OR NEW.suspended_at IS NOT NULL)
     AND NOT EXISTS(SELECT 1 FROM vaults.accounts WHERE tenant_id=OLD.tenant_id AND id<>OLD.id
       AND server_role='owner' AND enrollment_state='active' AND suspended_at IS NULL) THEN
    RAISE EXCEPTION 'LAST_ACTIVE_OWNER' USING ERRCODE='P0001';
  END IF;
  IF TG_OP='UPDATE' AND OLD.server_role<>'owner' AND NEW.server_role='owner'
     AND NOT EXISTS(SELECT 1 FROM vaults.ownership_grants WHERE tenant_id=OLD.tenant_id AND recipient_id=OLD.id
       AND accepted_at IS NOT NULL AND applied_at IS NULL AND cancelled_at IS NULL AND expires_at>now()) THEN
    RAISE EXCEPTION 'OWNERSHIP_ACCEPTANCE_REQUIRED' USING ERRCODE='P0001';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_active_owners BEFORE UPDATE OR DELETE ON vaults.accounts
  FOR EACH ROW EXECUTE FUNCTION vaults.protect_active_owners();

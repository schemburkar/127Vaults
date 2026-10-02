-- Experimental schema 1. No credential, device, or cryptographic wire format.
CREATE SCHEMA vaults;
CREATE TABLE vaults.schema_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL CHECK (version = 1),
  checksum text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vaults.installation (
  id uuid PRIMARY KEY,
  singleton boolean NOT NULL UNIQUE DEFAULT true CHECK (singleton),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vaults.accounts (
  tenant_id uuid NOT NULL REFERENCES vaults.installation(id),
  id uuid NOT NULL,
  username text COLLATE "C" NOT NULL CHECK (username ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]{4,63}$'),
  username_key text COLLATE "C" GENERATED ALWAYS AS (lower(username)) STORED,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 128),
  email text COLLATE "C" NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  server_role text NOT NULL CHECK (server_role IN ('owner', 'user')),
  enrollment_state text NOT NULL DEFAULT 'pending' CHECK (enrollment_state IN ('pending','active')),
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, username_key),
  UNIQUE (tenant_id, email)
);
CREATE UNIQUE INDEX one_provisional_owner ON vaults.accounts (tenant_id) WHERE server_role = 'owner';
CREATE TABLE vaults.bootstrap_tokens (
  tenant_id uuid PRIMARY KEY REFERENCES vaults.installation(id),
  token_digest bytea NOT NULL CHECK (octet_length(token_digest)=32),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vaults.invitation_records (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  token_digest bytea NOT NULL CHECK (octet_length(token_digest)=32),
  created_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, token_digest),
  FOREIGN KEY (tenant_id, created_by) REFERENCES vaults.accounts(tenant_id, id)
);
CREATE TABLE vaults.invitation_emails (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  email text COLLATE "C" NOT NULL,
  redeemed_at timestamptz,
  account_id uuid,
  PRIMARY KEY(tenant_id,id,email),
  FOREIGN KEY(tenant_id,id) REFERENCES vaults.invitation_records(tenant_id,id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES vaults.accounts(tenant_id,id)
);
CREATE TABLE vaults.onboarding_attempts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  email text COLLATE "C" NOT NULL,
  capability_digest bytea NOT NULL CHECK(octet_length(capability_digest)=32),
  candidate jsonb NOT NULL CHECK(jsonb_typeof(candidate)='object'),
  expires_at timestamptz NOT NULL,
  email_generation bigint NOT NULL DEFAULT 0,
  email_code_digest bytea CHECK(email_code_digest IS NULL OR octet_length(email_code_digest)=32),
  email_expires_at timestamptz,
  email_failures smallint NOT NULL DEFAULT 0 CHECK(email_failures BETWEEN 0 AND 5),
  email_sent_at timestamptz,
  email_send_count smallint NOT NULL DEFAULT 0 CHECK(email_send_count BETWEEN 0 AND 5),
  email_window_started timestamptz,
  committed_at timestamptz,
  account_id uuid,
  device_id uuid,
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,capability_digest),
  FOREIGN KEY(tenant_id,invitation_id,email) REFERENCES vaults.invitation_emails(tenant_id,id,email)
);
CREATE TABLE vaults.onboarding_rate_limits (
  source text COLLATE "C" NOT NULL,
  attempt_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL
);
CREATE FUNCTION vaults.reserve_onboarding_attempt(p_source text,p_now timestamptz,p_attempt uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF p_source IS NULL OR octet_length(p_source)>128 THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(127,6);
  DELETE FROM vaults.onboarding_rate_limits WHERE created_at < p_now-interval '1 hour';
  IF (SELECT count(*) FROM vaults.onboarding_rate_limits WHERE created_at>=p_now-interval '1 hour')>=100 OR
     (SELECT count(*) FROM vaults.onboarding_rate_limits WHERE source=p_source AND created_at>=p_now-interval '10 minutes')>=10 THEN RETURN false; END IF;
  INSERT INTO vaults.onboarding_rate_limits(source,attempt_id,created_at) VALUES(p_source,p_attempt,p_now);
  RETURN true;
END; $$;
-- Ownership changes are deliberately disabled until accepted transfers exist.
CREATE FUNCTION vaults.protect_provisional_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.server_role = 'owner' THEN
    RAISE EXCEPTION 'Provisional owner mutation requires a future reviewed ownership procedure';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.server_role <> OLD.server_role THEN
    RAISE EXCEPTION 'Role changes are not implemented';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_provisional_owner BEFORE UPDATE OR DELETE ON vaults.accounts
  FOR EACH ROW EXECUTE FUNCTION vaults.protect_provisional_owner();

-- OPAQUE/session storage contains only fixed-size protocol records, public device
-- keys and keyed token digests. Client credentials and decrypted key material
-- have no columns by design.
CREATE TABLE vaults.opaque_server_setup (
  tenant_id uuid PRIMARY KEY REFERENCES vaults.installation(id),
  profile smallint NOT NULL DEFAULT 1 CHECK (profile = 1),
  setup_bytes bytea NOT NULL CHECK (octet_length(setup_bytes) BETWEEN 96 AND 512),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vaults.authentication_credentials (
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  profile smallint NOT NULL DEFAULT 1 CHECK (profile = 1),
  credential_epoch bigint NOT NULL DEFAULT 1 CHECK (credential_epoch > 0),
  opaque_record bytea NOT NULL CHECK (octet_length(opaque_record) = 192),
  wrapped_root_descriptor bytea NOT NULL CHECK (octet_length(wrapped_root_descriptor) <= 4096),
  wrapped_root_envelope bytea NOT NULL CHECK (octet_length(wrapped_root_envelope) <= 16384),
  PRIMARY KEY (tenant_id, account_id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES vaults.accounts(tenant_id, id)
);
CREATE TABLE vaults.devices (
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  id uuid NOT NULL,
  signing_public_key bytea NOT NULL CHECK (octet_length(signing_public_key) = 32),
  credential_epoch bigint NOT NULL CHECK (credential_epoch > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES vaults.accounts(tenant_id, id)
);
CREATE TABLE vaults.authentication_attempts (
  tenant_id uuid NOT NULL,
  attempt_digest bytea NOT NULL CHECK (octet_length(attempt_digest) = 32),
  account_id uuid,
  device_id uuid NOT NULL,
  credential_epoch bigint NOT NULL CHECK (credential_epoch > 0),
  server_state bytea NOT NULL CHECK (octet_length(server_state) <= 2048),
  request_bytes bytea NOT NULL CHECK (octet_length(request_bytes) = 96),
  response_bytes bytea NOT NULL CHECK (octet_length(response_bytes) = 320),
  binding_bytes bytea NOT NULL CHECK (octet_length(binding_bytes) BETWEEN 2 AND 393),
  wrapped_root_descriptor bytea CHECK (wrapped_root_descriptor IS NULL OR octet_length(wrapped_root_descriptor) <= 4096),
  wrapped_root_envelope bytea CHECK (wrapped_root_envelope IS NULL OR octet_length(wrapped_root_envelope) <= 16384),
  device_public_key bytea CHECK (device_public_key IS NULL OR octet_length(device_public_key) = 32),
  root_response_tag bytea CHECK (root_response_tag IS NULL OR octet_length(root_response_tag) = 64),
  password_completed_at timestamptz,
  device_consumed_at timestamptz,
  transcript_hash bytea NOT NULL CHECK (octet_length(transcript_hash) = 64),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (tenant_id, attempt_digest)
);
CREATE INDEX authentication_attempt_account ON vaults.authentication_attempts
  (tenant_id, account_id, device_id) WHERE consumed_at IS NULL;
CREATE TABLE vaults.authentication_failures (
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  consecutive integer NOT NULL DEFAULT 0 CHECK (consecutive BETWEEN 0 AND 20),
  delayed_until timestamptz,
  admin_locked boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, account_id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES vaults.accounts(tenant_id, id)
);
CREATE TABLE vaults.authentication_capabilities (
  tenant_id uuid NOT NULL,
  capability_digest bytea NOT NULL CHECK (octet_length(capability_digest) = 32),
  attempt_digest bytea NOT NULL CHECK (octet_length(attempt_digest) = 32),
  account_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (tenant_id, capability_digest)
);
CREATE TABLE vaults.authentication_rate_limits (
  tenant_id uuid NOT NULL REFERENCES vaults.installation(id),
  source text COLLATE "C" NOT NULL CHECK (octet_length(source) BETWEEN 1 AND 128),
  username_key text COLLATE "C" NOT NULL CHECK (octet_length(username_key) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL
);
CREATE INDEX authentication_rate_time ON vaults.authentication_rate_limits(tenant_id,created_at);
CREATE TABLE vaults.sessions (
  tenant_id uuid NOT NULL,
  token_digest bytea NOT NULL CHECK (octet_length(token_digest) = 32),
  account_id uuid NOT NULL,
  device_id uuid NOT NULL,
  credential_epoch bigint NOT NULL CHECK (credential_epoch > 0),
  csrf_digest bytea NOT NULL CHECK (octet_length(csrf_digest) = 32),
  csrf_cipher bytea NOT NULL CHECK (octet_length(csrf_cipher) = 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at <= created_at + interval '12 hours'),
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, token_digest),
  FOREIGN KEY (tenant_id, account_id) REFERENCES vaults.accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES vaults.devices(tenant_id, id)
);
CREATE TABLE vaults.private_vaults (
 tenant_id uuid NOT NULL, id uuid NOT NULL, account_id uuid NOT NULL, epoch bigint NOT NULL CHECK(epoch=1),
 vault_envelope_revision uuid NOT NULL, vault_envelope bytea NOT NULL CHECK(octet_length(vault_envelope)<=205),
 catalogue_revision uuid NOT NULL, catalogue bytea NOT NULL CHECK(octet_length(catalogue)<=6910),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,account_id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES vaults.accounts(tenant_id,id)
);
CREATE TABLE vaults.private_directories (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, revision uuid NOT NULL, directory bytea NOT NULL CHECK(octet_length(directory)<=462),
 PRIMARY KEY(tenant_id,account_id), FOREIGN KEY(tenant_id,account_id) REFERENCES vaults.accounts(tenant_id,id)
);
CREATE TABLE vaults.private_items (
 tenant_id uuid NOT NULL, vault_id uuid NOT NULL, item_id uuid NOT NULL, logical_revision uuid NOT NULL,
 index_revision uuid NOT NULL, body_revision uuid NOT NULL, index_envelope bytea NOT NULL CHECK(octet_length(index_envelope)<=65709),
 body_envelope bytea NOT NULL CHECK(octet_length(body_envelope)<=1048749), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,vault_id,item_id), FOREIGN KEY(tenant_id,vault_id) REFERENCES vaults.private_vaults(tenant_id,id)
);
CREATE TABLE vaults.private_receipts (
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, request_id uuid NOT NULL, fingerprint bytea NOT NULL CHECK(octet_length(fingerprint)=32),
 response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,account_id,request_id)
);
CREATE TABLE vaults.private_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(), tenant_id uuid NOT NULL,
 account_id uuid NOT NULL, device_id uuid NOT NULL, vault_id uuid NOT NULL, item_id uuid, request_id uuid NOT NULL,
 action text COLLATE "C" NOT NULL CHECK(action IN('vault.create','item.create','item.update')), old_revision uuid, new_revision uuid NOT NULL, outcome text NOT NULL DEFAULT 'accepted'
);

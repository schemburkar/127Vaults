-- Reviewed schema 1 -> 2 DDL. The caller verifies the schema-1 manifest,
-- holds vaults' provisioning advisory transaction lock, and updates the
-- schema manifest only after this file and post-DDL validation succeed.
ALTER TABLE vaults.schema_version DROP CONSTRAINT schema_version_version_check;
ALTER TABLE vaults.schema_version ADD CONSTRAINT schema_version_version_check CHECK (version IN (1,2));

ALTER TABLE vaults.accounts
  ADD COLUMN session_epoch bigint NOT NULL DEFAULT 1 CHECK (session_epoch > 0),
  ADD COLUMN recovery_state text NOT NULL DEFAULT 'available'
    CHECK (recovery_state IN ('available','lost_last_device','proof_verified','pending_delay'));

ALTER TABLE vaults.devices
  ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('pending','active','revoked','replaced')),
  ADD COLUMN auth_epoch bigint NOT NULL DEFAULT 1 CHECK (auth_epoch > 0),
  ADD COLUMN credential_epoch_seen bigint CHECK (credential_epoch_seen IS NULL OR credential_epoch_seen > 0),
  ADD COLUMN credential_state text NOT NULL DEFAULT 'current'
    CHECK (credential_state IN ('current','rotation_required','stale')),
  ADD COLUMN protection_class text NOT NULL DEFAULT 'unknown'
    CHECK (protection_class IN ('unknown','software','platform','hardware')),
  ADD COLUMN protection_verified_at timestamptz,
  ADD COLUMN revoked_at timestamptz,
  ADD CONSTRAINT devices_account_identity_unique UNIQUE (tenant_id,account_id,id);
UPDATE vaults.devices SET
  credential_epoch_seen = credential_epoch,
  lifecycle_status = CASE WHEN active THEN 'active' ELSE 'revoked' END,
  revoked_at = CASE WHEN active THEN NULL ELSE now() END;
ALTER TABLE vaults.devices
  DROP COLUMN active,
  ADD COLUMN active boolean GENERATED ALWAYS AS (lifecycle_status = 'active') STORED,
  ADD CONSTRAINT devices_revocation_consistent CHECK (
    (lifecycle_status IN ('revoked','replaced') AND revoked_at IS NOT NULL) OR
    (lifecycle_status NOT IN ('revoked','replaced') AND revoked_at IS NULL));
ALTER TABLE vaults.devices ALTER COLUMN credential_epoch_seen SET NOT NULL;

ALTER TABLE vaults.sessions
  ADD COLUMN session_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN session_epoch bigint NOT NULL DEFAULT 1 CHECK (session_epoch > 0),
  ADD COLUMN device_auth_epoch bigint NOT NULL DEFAULT 1 CHECK (device_auth_epoch > 0),
  ADD CONSTRAINT sessions_public_id_unique UNIQUE (session_id),
  ADD CONSTRAINT sessions_account_public_id_unique UNIQUE (tenant_id,account_id,session_id),
  ADD CONSTRAINT sessions_account_device_fk FOREIGN KEY (tenant_id,account_id,device_id)
    REFERENCES vaults.devices(tenant_id,account_id,id);

CREATE TABLE vaults.device_enrollments (
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  id uuid NOT NULL,
  approver_session_id uuid NOT NULL,
  new_device_session_id uuid,
  proposed_device_id uuid NOT NULL,
  proposed_signing_public_key bytea NOT NULL CHECK (octet_length(proposed_signing_public_key)=32),
  protection_class text NOT NULL CHECK (protection_class IN ('unknown','software','platform','hardware')),
  protection_verified boolean NOT NULL DEFAULT false,
  credential_epoch_snapshot bigint NOT NULL CHECK (credential_epoch_snapshot > 0),
  code_digest bytea NOT NULL CHECK (octet_length(code_digest)=32),
  approval_signature bytea CHECK (approval_signature IS NULL OR octet_length(approval_signature)=64),
  possession_signature bytea CHECK (possession_signature IS NULL OR octet_length(possession_signature)=64),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  PRIMARY KEY (tenant_id,account_id,id),
  UNIQUE (tenant_id,proposed_device_id),
  UNIQUE (tenant_id,code_digest),
  FOREIGN KEY (tenant_id,account_id) REFERENCES vaults.accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,account_id,approver_session_id) REFERENCES vaults.sessions(tenant_id,account_id,session_id),
  FOREIGN KEY (tenant_id,account_id,new_device_session_id) REFERENCES vaults.sessions(tenant_id,account_id,session_id),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR cancelled_at IS NULL)
);
CREATE TABLE vaults.device_recoveries (
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('offline_kit','selected_admin')),
  replacement_device_id uuid NOT NULL,
  replacement_signing_public_key bytea NOT NULL CHECK (octet_length(replacement_signing_public_key)=32),
  eligible_admin_account_id uuid,
  status text NOT NULL DEFAULT 'pending_delay'
    CHECK (status IN ('pending_delay','proof_verified','completed','cancelled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delay_until timestamptz NOT NULL,
  proof_verified_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  ceremony_result bytea CHECK (ceremony_result IS NULL OR octet_length(ceremony_result) BETWEEN 32 AND 4096),
  PRIMARY KEY (tenant_id,account_id,id),
  UNIQUE (tenant_id,replacement_device_id),
  FOREIGN KEY (tenant_id,account_id) REFERENCES vaults.accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,eligible_admin_account_id) REFERENCES vaults.accounts(tenant_id,id),
  CHECK (delay_until >= created_at),
  CHECK ((mode='selected_admin') = (eligible_admin_account_id IS NOT NULL)),
  CHECK ((status='completed') = (completed_at IS NOT NULL)),
  CHECK ((status='cancelled') = (cancelled_at IS NOT NULL)),
  CHECK ((status='expired') = (expired_at IS NOT NULL)),
  CHECK ((status='proof_verified') = (proof_verified_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL AND expired_at IS NULL)),
  CHECK (status <> 'completed' OR (proof_verified_at IS NOT NULL AND ceremony_result IS NOT NULL)),
  CHECK (num_nonnulls(completed_at,cancelled_at,expired_at) <= 1)
);

CREATE TABLE vaults.device_lifecycle_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  actor_device_id uuid,
  subject_device_id uuid,
  enrollment_id uuid,
  recovery_id uuid,
  action text COLLATE "C" NOT NULL CHECK (action IN (
    'enrollment.begin','enrollment.approve','enrollment.cancel','device.revoke',
    'credential.rotate','account_secret.rotate','recovery.begin','recovery.proof_verified',
    'recovery.cancel','recovery.complete')),
  outcome text COLLATE "C" NOT NULL CHECK (outcome IN ('accepted','rejected')),
  detail_hash bytea NOT NULL CHECK (octet_length(detail_hash)=32),
  FOREIGN KEY (tenant_id,account_id) REFERENCES vaults.accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_device_id) REFERENCES vaults.devices(tenant_id,id),
  FOREIGN KEY (tenant_id,subject_device_id) REFERENCES vaults.devices(tenant_id,id),
  FOREIGN KEY (tenant_id,account_id,enrollment_id) REFERENCES vaults.device_enrollments(tenant_id,account_id,id),
  FOREIGN KEY (tenant_id,account_id,recovery_id) REFERENCES vaults.device_recoveries(tenant_id,account_id,id)
);

CREATE TABLE vaults.sync_vault_state (
  tenant_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  epoch bigint NOT NULL CHECK (epoch > 0),
  next_cursor bigint NOT NULL DEFAULT 1 CHECK (next_cursor > 0),
  operation_head_hash bytea NOT NULL CHECK (octet_length(operation_head_hash)=32),
  latest_checkpoint_sequence bigint NOT NULL DEFAULT 0 CHECK (latest_checkpoint_sequence >= 0),
  latest_checkpoint_hash bytea NOT NULL CHECK (octet_length(latest_checkpoint_hash)=32),
  state text NOT NULL DEFAULT 'healthy' CHECK (state IN ('healthy','frozen','integrity_error')),
  PRIMARY KEY (tenant_id,vault_id),
  FOREIGN KEY (tenant_id,vault_id) REFERENCES vaults.private_vaults(tenant_id,id)
);
INSERT INTO vaults.sync_vault_state
  (tenant_id,vault_id,epoch,next_cursor,operation_head_hash,latest_checkpoint_sequence,latest_checkpoint_hash,state)
SELECT tenant_id,id,epoch,1,decode(repeat('00',32),'hex'),0,decode(repeat('00',32),'hex'),'healthy'
FROM vaults.private_vaults;
CREATE TABLE vaults.sync_device_heads (
  tenant_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  device_id uuid NOT NULL,
  last_operation_id bytea NOT NULL CHECK (octet_length(last_operation_id)=32),
  PRIMARY KEY (tenant_id,vault_id,device_id),
  FOREIGN KEY (tenant_id,vault_id) REFERENCES vaults.sync_vault_state(tenant_id,vault_id),
  FOREIGN KEY (tenant_id,device_id) REFERENCES vaults.devices(tenant_id,id)
);
CREATE TABLE vaults.sync_operations (
  tenant_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  cursor bigint NOT NULL CHECK (cursor > 0),
  protocol_version smallint NOT NULL CHECK (protocol_version = 1),
  operation_id bytea NOT NULL CHECK (octet_length(operation_id)=32),
  device_id uuid NOT NULL,
  epoch bigint NOT NULL CHECK (epoch > 0),
  causal_base bigint NOT NULL CHECK (causal_base >= 0),
  predecessor_operation_id bytea CHECK (predecessor_operation_id IS NULL OR octet_length(predecessor_operation_id)=32),
  kind text COLLATE "C" NOT NULL CHECK (kind IN ('item.create','item.update','item.delete','conflict.resolve')),
  item_id uuid,
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash)=32),
  client_time timestamptz,
  signature bytea NOT NULL CHECK (octet_length(signature)=64),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,vault_id,cursor),
  UNIQUE (tenant_id,vault_id,operation_id),
  FOREIGN KEY (tenant_id,vault_id) REFERENCES vaults.sync_vault_state(tenant_id,vault_id),
  FOREIGN KEY (tenant_id,device_id) REFERENCES vaults.devices(tenant_id,id),
  CHECK (item_id IS NOT NULL),
  CHECK (causal_base < cursor)
);
CREATE INDEX sync_operations_device_cursor ON vaults.sync_operations(tenant_id,vault_id,device_id,cursor);
CREATE TABLE vaults.sync_checkpoints (
  tenant_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  checkpoint_sequence bigint NOT NULL CHECK (checkpoint_sequence > 0),
  protocol_version smallint NOT NULL CHECK (protocol_version = 1),
  epoch bigint NOT NULL CHECK (epoch > 0),
  cursor bigint NOT NULL CHECK (cursor >= 0),
  previous_checkpoint_hash bytea NOT NULL CHECK (octet_length(previous_checkpoint_hash)=32),
  operation_head_hash bytea NOT NULL CHECK (octet_length(operation_head_hash)=32),
  checkpoint_hash bytea NOT NULL CHECK (octet_length(checkpoint_hash)=32),
  server_signature bytea NOT NULL CHECK (octet_length(server_signature)=64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,vault_id,checkpoint_sequence),
  UNIQUE (tenant_id,vault_id,checkpoint_hash),
  FOREIGN KEY (tenant_id,vault_id) REFERENCES vaults.sync_vault_state(tenant_id,vault_id)
);

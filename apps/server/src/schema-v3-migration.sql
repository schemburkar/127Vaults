-- Schema 2 -> 3: server-rendezvous device enrollment.
ALTER TABLE vaults.schema_version DROP CONSTRAINT schema_version_version_check;
ALTER TABLE vaults.schema_version ADD CONSTRAINT schema_version_version_check CHECK (version IN (1,2,3));

CREATE TABLE vaults.device_enrollment_requests (
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  id uuid NOT NULL,
  username_key text COLLATE "C" NOT NULL CHECK (octet_length(username_key) BETWEEN 1 AND 64),
  code_digest bytea NOT NULL CHECK (octet_length(code_digest)=32),
  poll_token_digest bytea NOT NULL CHECK (octet_length(poll_token_digest)=32),
  proposed_device_id uuid NOT NULL,
  proposed_signing_public_key bytea NOT NULL CHECK (octet_length(proposed_signing_public_key)=32),
  request_signature bytea NOT NULL CHECK (octet_length(request_signature)=64),
  approver_device_id uuid,
  approval_signature bytea CHECK (approval_signature IS NULL OR octet_length(approval_signature)=64),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  consumed_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code_digest),
  UNIQUE (tenant_id,poll_token_digest),
  UNIQUE (tenant_id,proposed_device_id),
  FOREIGN KEY (tenant_id,account_id) REFERENCES vaults.accounts(tenant_id,id),
  FOREIGN KEY (tenant_id,approver_device_id) REFERENCES vaults.devices(tenant_id,id),
  CHECK (expires_at > created_at),
  CHECK (approved_at IS NULL OR approver_device_id IS NOT NULL),
  CHECK (consumed_at IS NULL OR approved_at IS NOT NULL)
);
CREATE INDEX device_enrollment_request_expiry ON vaults.device_enrollment_requests(expires_at);

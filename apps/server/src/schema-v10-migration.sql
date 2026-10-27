-- Schema 9 -> 10: independent ingress budgets; no vault ciphertext changes.
ALTER TABLE vaults.schema_version DROP CONSTRAINT schema_version_version_check;
ALTER TABLE vaults.schema_version ADD CONSTRAINT schema_version_version_check CHECK (version BETWEEN 1 AND 10);
CREATE TABLE vaults.security_request_limits (
  tenant_id uuid NOT NULL REFERENCES vaults.installation(id),
  purpose text NOT NULL CHECK (purpose IN ('registration','enrollment')),
  source text NOT NULL CHECK (octet_length(source) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL
);
CREATE INDEX security_request_source_time ON vaults.security_request_limits(tenant_id,purpose,source,created_at);
CREATE INDEX security_request_expiry ON vaults.security_request_limits(created_at);
CREATE INDEX private_receipt_account_time ON vaults.private_receipts(tenant_id,account_id,created_at);
CREATE INDEX authentication_attempt_expiry ON vaults.authentication_attempts(tenant_id,expires_at);

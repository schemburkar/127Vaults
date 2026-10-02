-- Schema 4 -> 5: opaque account-scoped vault settings.
ALTER TABLE vaults.schema_version DROP CONSTRAINT schema_version_version_check;
ALTER TABLE vaults.schema_version ADD CONSTRAINT schema_version_version_check CHECK (version IN (1,2,3,4,5));
CREATE TABLE vaults.private_account_settings (
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  revision uuid NOT NULL,
  envelope bytea NOT NULL CHECK (octet_length(envelope) BETWEEN 174 AND 16557),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,account_id),
  FOREIGN KEY (tenant_id,account_id) REFERENCES vaults.accounts(tenant_id,id)
);

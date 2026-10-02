-- Schema 5 -> 6: recoverable vault retirement and idempotent choice receipts.
ALTER TABLE vaults.schema_version DROP CONSTRAINT schema_version_version_check;
ALTER TABLE vaults.schema_version ADD CONSTRAINT schema_version_version_check CHECK (version IN (1,2,3,4,5,6));
ALTER TABLE vaults.private_vaults ADD COLUMN retired_at timestamptz;
ALTER TABLE vaults.private_vaults ADD COLUMN retirement_choice text COLLATE "C" CHECK (retirement_choice IN ('archive','move'));
ALTER TABLE vaults.private_vaults ADD COLUMN retirement_destination uuid;
ALTER TABLE vaults.private_vaults ADD CONSTRAINT private_vault_retirement_consistent CHECK (
  (retired_at IS NULL AND retirement_choice IS NULL AND retirement_destination IS NULL) OR
  (retired_at IS NOT NULL AND retirement_choice IS NOT NULL AND retirement_choice='archive' AND retirement_destination IS NULL) OR
  (retired_at IS NOT NULL AND retirement_choice IS NOT NULL AND retirement_choice='move' AND retirement_destination IS NOT NULL)
);
CREATE TABLE vaults.private_vault_removal_receipts (
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_id uuid NOT NULL,
  fingerprint bytea NOT NULL CHECK (octet_length(fingerprint)=32),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,account_id,request_id),
  FOREIGN KEY (tenant_id,account_id) REFERENCES vaults.accounts(tenant_id,id)
);
CREATE TABLE vaults.private_vault_move_items (
  tenant_id uuid NOT NULL,
  source_vault_id uuid NOT NULL,
  source_item_id uuid NOT NULL,
  destination_vault_id uuid NOT NULL,
  destination_item_id uuid NOT NULL,
  PRIMARY KEY (tenant_id,source_vault_id,source_item_id),
  UNIQUE (tenant_id,destination_vault_id,destination_item_id),
  FOREIGN KEY (tenant_id,source_vault_id) REFERENCES vaults.private_vaults(tenant_id,id),
  FOREIGN KEY (tenant_id,destination_vault_id) REFERENCES vaults.private_vaults(tenant_id,id)
);

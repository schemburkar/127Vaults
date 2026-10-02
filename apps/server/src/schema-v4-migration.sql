-- Schema 3 -> 4: permit several private vaults per account.
ALTER TABLE vaults.schema_version DROP CONSTRAINT schema_version_version_check;
ALTER TABLE vaults.schema_version ADD CONSTRAINT schema_version_version_check CHECK (version IN (1,2,3,4));
ALTER TABLE vaults.private_vaults DROP CONSTRAINT private_vaults_tenant_id_account_id_key;
CREATE INDEX private_vaults_account ON vaults.private_vaults(tenant_id,account_id);

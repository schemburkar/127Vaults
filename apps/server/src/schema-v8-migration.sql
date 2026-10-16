-- Schema 7 -> 8: allow authenticated individual-item deletion audit entries.
-- Existing content, history and receipts remain unchanged.
ALTER TABLE vaults.schema_version DROP CONSTRAINT schema_version_version_check;
ALTER TABLE vaults.schema_version ADD CONSTRAINT schema_version_version_check
  CHECK (version IN (1,2,3,4,5,6,7,8));
ALTER TABLE vaults.private_audit DROP CONSTRAINT private_audit_action_check;
ALTER TABLE vaults.private_audit ADD CONSTRAINT private_audit_action_check
  CHECK (action IN ('vault.create','item.create','item.update','item.delete'));

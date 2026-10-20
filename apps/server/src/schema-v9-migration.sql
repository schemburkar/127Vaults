-- Schema 8 -> 9: enlarge authenticated record capacity without changing existing bytes.
ALTER TABLE vaults.schema_version DROP CONSTRAINT schema_version_version_check;
ALTER TABLE vaults.schema_version ADD CONSTRAINT schema_version_version_check
  CHECK (version IN (1,2,3,4,5,6,7,8,9));
ALTER TABLE vaults.private_vaults DROP CONSTRAINT private_vaults_catalogue_check;
ALTER TABLE vaults.private_vaults ADD CONSTRAINT private_vaults_catalogue_check
  CHECK (octet_length(catalogue)<=13710);
ALTER TABLE vaults.private_directories DROP CONSTRAINT private_directories_directory_check;
ALTER TABLE vaults.private_directories ADD CONSTRAINT private_directories_directory_check
  CHECK (octet_length(directory)<=822);

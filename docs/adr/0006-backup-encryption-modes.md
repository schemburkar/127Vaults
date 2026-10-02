# ADR-0006: BYO backup storage and dual recovery modes

- Status: Proposed
- Date: 2026-09-06

## Decision

127Vaults creates consistent PostgreSQL backups, compresses them, applies an
application-level authenticated-encryption envelope, uploads them to customer
storage, and verifies the result. Initial destinations are S3-compatible object
storage followed by Azure Blob Storage. Provider-side encryption is defense in
depth, not a substitute for application encryption.

Two restore modes are required:

1. **Convenience:** the server retains or can unwrap the backup key and can run
   unattended backup and restore.
2. **High security:** backup data keys are wrapped to a customer-controlled public
   recovery key; restoring requires the offline private recovery key.

Storage credentials and encryption keys are distinct. AWS credentials/roles or
Azure identities receive least-privilege access to a dedicated bucket/container.
Customer-managed KMS/Key Vault keys may add provider-side control.

Each backup has an authenticated manifest containing format/schema version,
server identity, timestamp, database checksum, object inventory, and required
127Vaults version. Retention, key rotation, interrupted uploads, rollback, restore
testing, and deletion behavior remain to be specified.


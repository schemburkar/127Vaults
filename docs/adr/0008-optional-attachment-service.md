# ADR-0008: Optional attachment service

- Status: Proposed
- Date: 2026-09-06

## Decision

Attachments are a separately installed server capability. A 127Vaults deployment
without it remains fully functional for all core item types. The service exposes
a versioned provider interface so operators may select local object storage,
S3-compatible storage, Azure Blob, or a future custom provider.

Clients encrypt attachment chunks before upload using keys distinct from item and
vault keys. PostgreSQL stores only opaque attachment manifests, membership-bound
references, provider-neutral object identifiers, sizes, and integrity metadata.
Provider credentials remain server-side and never enter vault records.

The design must specify chunking, resumable transfer, deduplication leakage,
quotas, garbage collection, deletion, provider migration, offline availability,
malware-content handling, and backup/restore consistency before implementation.

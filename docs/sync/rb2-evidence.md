# RB2 signed-sync vertical slice evidence

Status: domain/service review candidate; not enabled in the live API and not approved for real secrets.

Protocol version 1 uses canonical restricted JSON, content-derived SHA-256 operation IDs, Ed25519 signatures, causal cursors, per-device predecessor chains, and hash-chained signed checkpoints. Tests cover idempotency, pagination, tampering, wrong device/vault/epoch, device forks, and checkpoint rollback/forks.

The in-memory reference service is deliberately not wired into schema 1 or the live private-vault API. Durable PostgreSQL tables, authenticated HTTP handlers, conflict/tombstone materialization, snapshots/compaction, and durable client checkpoint comparison remain required before RB2 completion. Existing data is unchanged.

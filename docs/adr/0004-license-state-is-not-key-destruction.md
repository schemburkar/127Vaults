# ADR-0004: License state is not key destruction

- Status: Proposed
- Date: 2026-09-06

## Decision

An expired license moves through application states: valid, 30-day read-only
grace, then locked until a valid signed license is installed. Expiry never deletes
or mutates encrypted data, key envelopes, or backups. Renewing restores access.

Licensing is independent of key derivation and encryption. Offline clock rollback,
server migration, disaster recovery, grace-period persistence, and emergency
export behavior require explicit designs and tests.


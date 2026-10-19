# ADR-0004: License state is not key destruction

- Status: Proposed
- Date: 2026-09-06

## Decision

An expired license moves through application states: valid, 30-day read-only
grace, then locked until a valid signed license is installed. Expiry never deletes
or mutates encrypted data, key envelopes, or backups. A valid renewal removes the
licensing restriction for its covered scope; successful data access still requires
intact data, credentials, recovery material and a compatible installation. Renewal
is not a guarantee of indefinite recovery or support.

The adopted Commercial License Agreement limits post-expiry self-hosted read/export permission to
30 calendar days, including offline clients. This is a contractual boundary, not
a claim that all clients enforce it today. Existing offline clients can retain
local access and queue edits; the server's write guard does not establish a
complete read or offline lock. Verify the supported export path and client
enforcement before advertising an enforced cutoff. Cloud requires
its own finite export and retention schedule before an order is accepted.

Licensing is independent of key derivation and encryption. Offline clock rollback,
server migration, disaster recovery, grace-period persistence, and emergency
export behavior require explicit designs and tests.


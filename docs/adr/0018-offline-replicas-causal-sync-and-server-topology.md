# ADR-0018: Offline replicas, causal field sync, and server topology

- Status: Accepted
- Date: 2026-09-06

## Context

127Vaults must remain useful when a self-hosted server is unavailable. Devices
can independently edit the same item while offline, their clocks may disagree,
and membership or device authorization may change before queued edits arrive.
Cloud operation also needs horizontal service redundancy without silently
turning the protocol into an unreviewed active-active distributed database.

## Decision

Offline-capable authorized clients hold complete encrypted replicas of accessible
vaults. The server coordinates an encrypted operation log, authorization, cursor
progress, and a canonical accepted order. The web client remains online-only.

Conflict detection uses causal base revisions, not wall-clock time. Different
fields merge automatically. Divergent concurrent values for the same field are
retained and require an explicit user resolution operation. A writer may choose
value A, value B, or both; keeping both creates distinct item copies. Any member
with write access may resolve conflicts in v1. Wall-clock timestamps remain
non-authoritative UI and audit metadata.

Unresolved field conflicts may remain indefinitely and do not block unrelated
fields. Editing the conflicting field requires resolution first. A duplicated
item receives the suffix `Copy` until renamed.

A concurrent delete is a conflicting tombstone. The item remains in the vault's
conflict view until a writer first chooses whether it is kept or deleted and, if
kept, whether the pre-delete value, edited value, or both are retained. Because
item existence is unresolved, no field on that item may be edited first.

Removed members and revoked devices cannot submit queued operations. An authorized
device whose operation trails a key rotation may use a strictly validated
rebase/reencryption flow without recovering plaintext at the server.

Self-hosted v1 has one logical authority. Cloud may horizontally scale stateless
front ends around one transactional write authority per tenant and use fenced
failover/read replicas. Active-active multi-writer regions are deferred.

Clients verify signed operations and hash-linked checkpoints and remember observed
state for local rollback detection. No central 127Vaults integrity service is
mandatory. A privacy-preserving optional transparency/notary service is a v2
candidate.

## Consequences

- A server outage does not prevent an enrolled installed client from reading or
  editing its local vault.
- Same-field divergence is never resolved by last-writer-wins.
- Revocation can intentionally discard offline edits that were never accepted.
- A locally remembered checkpoint detects rollback, but fully isolated split
  views require checkpoint comparison or an optional external notary to detect.
- Cloud redundancy does not yet provide concurrent cross-region writes.

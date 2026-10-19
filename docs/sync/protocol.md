# Sync protocol (working requirements)

The sync protocol is an authenticated encrypted operation log. This document
defines requirements before endpoint or database design.

Clients must be able to validate an operation's author, vault, logical identity,
cryptographic version, and ciphertext integrity without trusting server policy.
The design must specify:

- stable operation identifiers and idempotency;
- optimistic concurrency and conflict semantics;
- replay, rollback, omission, reordering, and fork detection;
- create/update/delete and tombstone retention;
- offline edits and multi-device convergence;
- membership changes, device revocation, and vault-key rotation;
- snapshot/compaction without losing verifiability;
- server cursor semantics and protocol-version negotiation;
- bounded storage and denial-of-service behavior.

## Decided synchronization model

Every authorized offline-capable installed client keeps a complete encrypted
replica of each vault it may access, together with its cursor and pending local
operations. An ordinary browser tab remains online-only; an installed PWA can persist an
encrypted replica and pending queue as described in [PWA behavior](../product/pwa.md).
The server stores the encrypted repository, orders accepted operations, enforces
authorization and key epochs, and distributes changes. It is authoritative for
coordination, but never for plaintext.

Operations use causal base revisions, stable operation identifiers, and a
server-assigned monotonic order. Device wall-clock timestamps are retained for
display and audit context only; they never decide which value wins.

The conflict boundary is a field:

- concurrent edits to different fields merge automatically;
- concurrent edits to the same field are both retained and surfaced for explicit
  resolution—there is no last-writer-wins rule;
- a later device evaluates its pending edit against the revisions already
  accepted when it synchronizes;
- delete is a tombstone operation with explicit edit/delete conflict semantics,
  not an ordinary field mutation;
- conflict resolution creates a new signed operation and preserves both prior
  candidates according to the configured encrypted-history policy.

Conflict resolution offers value A, value B, or both. Keeping both creates two
clearly identified item copies rather than combining ambiguous secret fields.
The duplicate receives the suffix `Copy` until the user renames it.
Any member with write access may resolve a conflict in v1; the server records the
resolver and source operations. Preferential UI for the devices/users that
created the conflicting operations remains open, but cannot be required because
those devices may never reconnect.

An unresolved field conflict does not block reading or editing unrelated fields
and may remain unresolved indefinitely with a visible conflict count. Attempting
to edit the conflicting field requires resolving its existing conflict first.

If an item deletion races with an offline edit, deletion is represented as a
conflicting tombstone and the item remains visible in the vault's conflict state.
The resolver first chooses whether to keep or delete the item. If kept, they then
choose whether to retain the pre-delete value, the concurrent edit, or both. A
delete conflict is the exception to field-local editing: the item's existence must
be resolved before any further item edit.

When a cursor is too old for incremental synchronization, the client downloads
and verifies a fresh encrypted snapshot, then rebases pending signed local
operations. Non-conflicting fields merge automatically and conflicting fields
follow the normal explicit resolution rules.

Persistent sockets carry only authenticated change-availability notifications.
Clients fetch encrypted operations and snapshots through the normal authenticated
HTTPS sync API, giving polling, retry, and socket wakeups one data-delivery path.

An operation from a still-authorized device may be accepted behind a vault-key
rotation only through a narrowly specified rebase/reencryption path. An operation
from a removed member or revoked device is rejected even if it was created while
that actor was authorized; revocation favors future confidentiality over delivery
of queued edits.

CRDTs are not assumed. Password records benefit from explicit same-field conflict
surfacing rather than automatic resolution that can silently lose secrets.

## Verified item revisions

An item's encrypted index and body form one authenticated logical revision. A
verified manifest binds tenant, vault, item, key epoch and the exact index/body
envelopes and their distinct encryption revision identifiers. Never derive expected
context solely from the object under validation. Reject missing or mismatched
pairs; a partially received or invalid revision cannot replace the last verified
item. Preserve that version for reading and show a visible verification error.

The [P3 private-vault contract](../architecture/private-vault-contract.md) specifies
internal-MVP MAC records, trusted directory/key descriptors, atomic publication,
expected-base writes, retries and bounds. Lazy listing verifies body commitments;
body authenticity is verified on open. Batch 8A separately owns signed operations
and durable checkpoint binding. This does not change
[ECF1](../security/experimental-crypto-format.md) bytes or imply ECF1 itself proves
pairing, freshness or authorship. Integrity failures follow the recovery path below.

## Server topology

Self-hosted deployments have one logical authoritative server and PostgreSQL
history. Cloud deployments may run multiple stateless API/sync instances and
standby/read infrastructure, but v1 still has one transactional write authority
per tenant. Active-active multi-writer regions are out of scope until ordering,
key rotation, failover fencing, and split-brain behavior have a reviewed design.

## Integrity and fork detection

V1 will not require a 127Vaults-operated master service. Clients retain signed
checkpoints and verify signed operations/hash-chain continuity so a device can
detect rollback against state it has already observed. Devices should exchange
or cross-sign checkpoints through the normal authenticated sync path where useful.

A malicious server can still maintain consistent, isolated histories for devices
that never compare checkpoints. An optional 127Vaults-hosted, self-hosted, or
federated transparency/notary service may be designed for v2. It must be opt-in,
must not be required to unlock or sync, and must document metadata leakage and
availability consequences.

## Corrupted or unverifiable history recovery

A signature, hash-chain, ciphertext-authentication, snapshot, or ordering failure
places only the affected vault into a sync-error state. Synchronization and new
writes for that vault stop; verified offline data remains readable. The client
preserves the suspect bytes and last verified checkpoint and must never silently
discard, reorder, overwrite, or accept the failing history.

Recovery proceeds in this order:

1. retry the authenticated fetch and rule out incomplete transport;
2. compare the last verified checkpoint with another enrolled device when one is
   available;
3. recover from a verified encrypted snapshot or backup;
4. permit a verified enrolled replica to propose a signed replacement snapshot
   only through an explicit repair ceremony;
5. export still-readable plaintext locally as a last-resort user action.

The server administrator may preserve data, restore database backups, and provide
diagnostics but cannot choose plaintext winners or decrypt the vault. Shared-vault
replacement requires the vault owner's approval and a four-hour notice to every
member. Managers cannot authorize replacement history.

A private-vault replacement requires its user's approval. A recovery admin can
assist only through the already-enabled four-hour selected-admin recovery
ceremony; recovery status alone is not repair authority.

If enrolled devices present divergent but individually valid signed checkpoints,
the vault freezes synchronization and writes for explicit owner review. Neither
wall-clock recency nor the server's preferred branch selects a winner.

Diagnostic exports exclude ciphertext by default. They may contain identifiers,
versions, hashes, signatures, timing, and non-secret runtime context. Adding
ciphertext requires explicit user consent and a warning that encrypted vault
material will leave the client; plaintext and usable keys are never included.

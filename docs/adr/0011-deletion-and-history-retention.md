# ADR-0011: Deletion and history retention

- Status: Proposed
- Date: 2026-09-06

## Item deletion

Writers may delete items. Deletion creates a signed tombstone and moves the item
to recoverable trash for 10 days. Authorized writers may inspect history and
restore the item during that period. After the deadline, the server purges its
current item ciphertext, retained value snapshots, password history, indexes, and
unneeded key envelopes according to the cryptographic-erasure design.

Backups may retain purged ciphertext until their own retention expires. User-facing
language must distinguish deletion from eventual backup expiry.

## Vault deletion state machine

A shared vault moves through these states:

```text
active -> pending deletion/read-only (4 hours)
       -> recoverable deleted (24 hours)
       -> purged
```

All current members receive an in-app/device notification when pending deletion
begins. During the four-hour period, reads, export, and cancellation are allowed;
item writes, membership changes, and new key epochs are frozen except operations
required to cancel deletion safely. After four hours the vault disappears from
normal use but remains restorable for 24 hours, then is purged.

Only the vault owner or a server administrator may cancel or restore deletion.
Managers cannot. Server-admin cancellation/restoration changes control-plane
state only and does not grant the administrator a vault key, membership, or read
access. Only the owner may initiate deletion in the initial permissions model.

A private vault skips the shared notification delay and enters the 24-hour
recoverable-deleted state immediately. The final authorization rules for canceling
or restoring vault deletion remain open.

Server wall-clock time alone must not make the transition forgeable or repeatable.
The protocol must define signed intent, idempotency, authoritative timestamps,
clock rollback, offline-client behavior, backup retention, and cancellation races.

## Two history layers

History separates event metadata from prior values:

1. **Metadata event:** actor, device, item, field category, action, timestamp, and
   cryptographic epoch; for example, “User X changed the item name.” It does not
   contain the old or new value. Retention is server-admin configurable, defaults
   to 90 days, and has a hard maximum of 365 days in this version. A future major
   version may add an explicitly selected five-year tier.
2. **Encrypted value snapshot:** enough authenticated encrypted state to show an
   authorized client “name changed from A to B” or restore a version. Its retention
   is server-admin configurable but hard-limited by code to 120 days.

Metadata must avoid accidentally encoding secrets in field names, item titles,
URLs, free-form reasons, or logs. Where metadata itself is sensitive, it remains
inside client-encrypted history rather than the server audit stream.

Every item retains created-at and last-edited-at lifecycle timestamps until the
item is finally purged. These are current object properties, not historical event
records, and therefore do not expire with history retention. The server records
authoritative receipt/update time; user-facing client time, if preserved, stays
inside authenticated encrypted item data so a client-controlled clock cannot
rewrite server chronology.

## Password-history exception

The last 10 distinct password values for an item are retained regardless of age,
even when normal value snapshots expire. They remain encrypted, visible only to
current authorized members, and are deleted when the item/vault is finally purged.
They must be rewrapped or re-encrypted across membership epochs so a removed member
cannot decrypt password history created after removal.

This exception increases the value of a stolen unlocked client and must have hard
limits: at most 10 values per item, no duplicate values, no plaintext server-side
comparison, and no inclusion in metadata-only audit events.

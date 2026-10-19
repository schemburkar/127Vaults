# CLI offline replica decision

> The incremental plan below records implementation sequencing. Encrypted offline replicas and signed synchronization now exist; see the [CLI guide](../product/cli-mvp.md) for current commands and limitations.

Status: **accepted for incremental implementation**

This decision specializes accepted ADR-0018 for the CLI. It is deliberately
reversible at the storage-adapter boundary; changing the file/database engine
must not change cryptographic or synchronization semantics.

## Decision

The CLI agent owns one complete encrypted local replica per accessible vault.
Normal vault and item commands operate on that replica. Network HTTP is confined
to authentication, enrollment, and a sync transport; command handlers must not
grow new request-per-command dependencies.

The replica persists only ciphertext and public synchronization metadata:

- encrypted directory, vault envelopes, catalogues, item indices, and item bodies;
- the last verified server cursor and signed checkpoint;
- verified signed operations needed after the latest snapshot;
- locally signed pending operations and their encrypted mutation payloads;
- explicit conflict and sync-error state containing no plaintext.

Root/vault keys, session cookies, account secrets, master passwords, and decrypted
item fields are never written to the replica. Device signing keys and the local
agent capability remain in OS credential storage.

## Transaction and sync rules

1. Unlock opens and verifies the local encrypted snapshot without requiring the
   server. Online authentication refreshes synchronization authority but is not
   required for an already enrolled replica to be read.
2. A mutation encrypts locally and commits the new replica revision plus a signed
   pending operation atomically before reporting success.
3. Sync pulls after the stored cursor, verifies every signature, causal link,
   checkpoint, authorization epoch, and ciphertext commitment, then applies all
   verified remote changes in one transaction.
4. Pending operations are rebased locally. Different-field changes merge;
   same-field and delete/edit divergence becomes explicit conflict state. There
   is no wall-clock or last-write-wins resolution.
5. Push is idempotent by operation ID. An acknowledgement advances local accepted
   state atomically; rejection preserves the pending bytes and records a safe
   reason. Revoked devices cannot push but retain readable verified ciphertext.
6. Any integrity failure freezes sync and mutation for only the affected vault.
   The last verified replica remains readable and suspect bytes are preserved.

## Initial implementation sequence

1. Migrate the transitional online CLI transport to `/api/v1` without changing
   command behavior.
2. Add a narrow `ReplicaStore` with atomic file replacement, strict size limits,
   versioning, and fail-closed parsing. Start with encrypted JSON records to avoid
   introducing a database dependency before invariants are covered by tests.
3. Add a `SyncTransport` adapter and move all operation/checkpoint HTTP behind it.
4. Hydrate and verify a local replica after online unlock; switch reads to it.
5. Commit local encrypted mutations and pending operations before network push.
6. Add offline unlock, conflict state, checkpoint rollback detection, revocation,
   and rebase tests before claiming offline-first support.

The current direct-online command path is transitional and must not be described
as offline-first until steps 2–6 are verified.

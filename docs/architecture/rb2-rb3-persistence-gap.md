# RB2/RB3 live-persistence gap

Status: implementation audit for the isolated private beta. Backup automation is
deferred; the migration must still be transactional, non-destructive, and tested
against a copy of schema 1 before it touches the live volume.

## Reusable schema 1 state

- `accounts(tenant_id,id)` is the lifecycle owner and authorization boundary.
  `authentication_credentials.credential_epoch` is the current account credential
  epoch and must remain the credential source of truth.
- `devices(tenant_id,id)` already supplies account ownership, the 32-byte Ed25519
  public key, active state, and credential epoch. Existing first devices can be
  backfilled as active/current without replacing their identifiers or keys.
- `sessions` already binds account, device, and credential epoch and supports
  revocation. It can be extended for lifecycle-wide invalidation.
- `private_vaults(tenant_id,id)` supplies vault existence, owner authorization, and
  key epoch. `private_items` remains the current materialized encrypted view; it is
  not an operation log. Existing receipts/audit rows remain useful for the legacy
  mutation API but cannot substitute for signed-operation idempotency/history.

## Required migration

Extend `accounts` with `session_epoch bigint NOT NULL DEFAULT 1` and a constrained
`recovery_state` (`available`, `lost_last_device`, `proof_verified`,
`pending_delay`). Extend `devices` with constrained lifecycle status, `auth_epoch`,
`credential_epoch_seen`, constrained `credential_state`, protection class and
verification fields, plus `revoked_at`. Keep `active` only during a compatibility
transition or make it a status-derived invariant; two independently writable
status columns are unsafe. Add a public random `session_id uuid UNIQUE` and
`session_epoch`/`device_auth_epoch` snapshots to `sessions`; never expose its token
digest as the lifecycle session identifier.

Add durable lifecycle tables:

- `device_enrollments`: tenant/account/enrollment IDs; approver and new-device
  session IDs; proposed device ID and exact 32-byte public key; protection result;
  credential-epoch snapshot; keyed 32-byte code digest; expiry, consumed and
  cancelled timestamps. Uniqueness must prevent a live/replayed enrollment from
  inserting the same device ID. Approval and new-device-possession signatures
  should be retained for audit evidence.
- `device_recoveries`: tenant/account/recovery ID, mode, replacement device/key,
  eligible admin, created/completes timestamps, constrained status and terminal
  timestamps. Selected-admin eligibility, offline-kit proof, and completion
  ceremony results must be written by reviewed adapters, not accepted as request
  booleans. Add an account/policy table before enabling selected-admin recovery.
- A lifecycle audit table for enrollment, revocation, rotations, recovery start,
  cancellation and completion. Security-notification delivery state may be a
  separate later table, but handler success must not imply a notice was sent.

Add durable sync tables:

- `sync_vault_state`, keyed by `(tenant_id,vault_id)` and referencing
  `private_vaults`, with epoch, next cursor, 32-byte operation-head hash, latest
  checkpoint sequence/hash, and a frozen/integrity-error state.
- `sync_device_heads`, keyed by `(tenant_id,vault_id,device_id)`, with the last
  32-byte operation ID. Append must lock both the vault state and device head so
  cursor assignment and fork checks are atomic.
- `sync_operations`, keyed by vault plus server-assigned positive `bigint` cursor,
  with protocol version, 32-byte operation ID, device FK, epoch, causal base,
  nullable 32-byte predecessor, constrained kind, nullable item UUID, 32-byte
  payload hash, optional client time, and 64-byte signature. Require unique
  `(tenant_id,vault_id,op_id)` for idempotency and bounded field sizes. Store enough
  typed fields to reconstruct the exact canonical signed body; do not rely on a
  rewritten JSON document.
- `sync_checkpoints`, append-only and keyed by vault plus checkpoint sequence,
  containing epoch, cursor, 32-byte previous-checkpoint and operation-head hashes,
  and 64-byte server signature. A checkpoint can legitimately advance its chain
  without advancing the operation cursor, so cursor alone is not its key.

Database checks can enforce shapes and references. Signature validation, current
device status/auth epoch, account ownership, causal-base bounds, predecessor
equality, hash-head advancement and checkpoint signing must occur together in the
same serializable/locked transaction. RB2 still lacks conflict/tombstone
materialization and snapshot/compaction; mounting the log does not make those
features complete.

## Schema/checksum consequences

`schema.sql` is schema 1 and `requireSchema()` requires both version `1` and the
exact whole-file SHA-256. Any edit makes the server and provisioner refuse the
existing volume. Introduce schema 2 plus a single reviewed `1 -> 2` migration that
first verifies the known schema-1 checksum, takes the provisioning advisory lock,
runs all DDL/backfills in one transaction, validates row counts/FKs/invariants,
then updates `schema_version` and checksum last. Fresh initialization must install
the identical schema-2 result. Do not make startup auto-migrate, and do not edit
the stored schema-1 checksum in place. Add explicit `migrate` and dry-run/status
paths; rollback means restoring the pre-migration database copy because committed
DDL/data backfills are not safely reversed.

## HTTP surface to mount

All routes use the existing authenticated session; unsafe existing-device calls
also require same-origin CSRF. Enforce tenant/account/device from authentication,
never from caller-supplied authority fields.

- Signed sync: append an operation; fetch operations by exclusive cursor and
  bounded limit; get/create the latest signed checkpoint; expose the pinned
  checkpoint verification public key/version to clients. Scope every route by
  vault and reject revoked/stale devices before reads and writes.
- Lifecycle: list account/device state; begin enrollment; relay/fetch the bound
  pending enrollment through a one-use capability for the not-yet-authenticated
  device; submit trusted-device approval plus new-device possession; revoke a
  device; rotate password credentials; rotate the account secret/replacement
  identity; begin, cancel, inspect, and complete lost-device recovery. Rotation
  endpoints must atomically update OPAQUE/root envelopes, epochs, devices and
  sessions rather than merely calling the current in-memory epoch methods.

Use a versioned private-beta namespace (for example `/api/experimental/v1/sync/...`
and `/api/experimental/v1/device-lifecycle/...`) until the protocol registry and
wire contracts are accepted. Define request/response schemas and uniform error
mapping before wiring `main.mjs`.

## Safe implementation order

1. Freeze route contracts, raw-key encodings, authorization matrix, checkpoint-key
   loading/rotation, and adapter boundaries; remove caller-controlled proof flags.
2. Implement and test schema 2 plus explicit migration on an initialized schema-1
   database containing accounts, sessions, a private vault and items.
3. Implement PostgreSQL lifecycle transactions first, backfill existing devices,
   and make authentication consult the new epochs/status. Then mount lifecycle
   handlers and notifications/audit.
4. Implement PostgreSQL sync append/fetch/checkpoint transactions and mount their
   handlers. Keep the existing private-vault API operational while the web client
   adopts the log; do not dual-write without one database transaction and an
   explicit compatibility rule.
5. Connect web and CLI clients, run first fictitious-data human flows, then add the
   deferred web/CLI interoperability, crash, concurrency, rollback and replay
   suites before allowing real private-beta data.

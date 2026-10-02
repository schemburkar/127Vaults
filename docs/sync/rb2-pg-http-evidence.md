# RB2 PostgreSQL and HTTP slice

The schema-v2 signed-operation log now has an isolated PostgreSQL adapter and an
authenticated HTTP handler. They are intentionally not mounted by this slice.

`PgSignedSyncStore` serializes each append on `sync_vault_state`, verifies the
operation with the authenticated active device key, returns the original cursor
for an exact operation retry, rejects a future causal base or a divergent device
predecessor, and advances the operation and device hash heads in the same
transaction. Fetches use exclusive cursors and a bounded 1..500 page size.
Checkpoints are signed from locked durable heads and the checkpoint row and vault
checkpoint head are committed together.

Authorization reflects schema v2's current owner-only private-vault model: tenant,
vault owner, active authenticated device, vault epoch, and credential epoch must
all agree. This does not claim shared-vault membership authorization.

The HTTP namespace is `/api/experimental/v1/sync/:vaultId`. It provides `GET` and
`POST /operations`, plus `GET` and `POST /checkpoint`. Mutation requests require
the exact configured HTTPS Origin and session CSRF. JSON, fields, IDs, cursors,
page sizes, signatures, and request bodies are bounded; error responses expose
only stable categories.

The fake PostgreSQL tests exercise transactional append, idempotency, rollback on
causal rejection, and checkpoint persistence. Handler tests exercise authenticated
fetch, Origin/CSRF rejection, strict operation envelopes, checkpoint routing, and
detail-safe failures. `npm test --prefix apps/server` passes 42 tests with one
platform-specific permission test skipped.

## Mount contract

Construct `new PgSignedSyncStore(pool, checkpointPrivateKey)`, then
`createSignedSyncHandler(store, token => authService.authenticate(token),
transport.origin)`. Invoke the returned handler after authentication/onboarding
handlers and before the unsigned private-vault handler. The mount must load a
stable Ed25519 checkpoint private key from a protected file; generating it at
startup would break checkpoint verification after restart. The corresponding
pinned public key still needs an authenticated discovery or installation-config
contract before independent clients can verify checkpoints.

# Required individual-item deletion — implementation checkpoint

The user requires item deletion for internal release. The implementation now
spans Core/WASM, the server, native client/CLI, Desktop and web/PWA. Internal
release remains incomplete until affected packages are rebuilt and the release
inventory and packaged sanity evidence are updated.

## Product changes

- Core removes exactly one authenticated catalogue entry and advances its linked
  revision without changing sibling commitments.
- HTTP DELETE accepts a signed catalogue-only proposal. PostgreSQL atomically
  removes the scoped ciphertext row and commits catalogue, signed history, audit
  and idempotent receipt. Deleted identities cannot be recreated. DELETE is
  covered by the existing license write guard.
- Schema 8 extends the audit action constraint. Schema 7 remains a recognized,
  frozen migration source; explicit dry-run/apply preserves existing content.
- CLI `item delete`, Desktop and web confirmation actions queue encrypted
  requests durably offline. Native and installed-web replay use DELETE and stable
  request/signature bytes. Conflicting peer edits require an explicit choice.
- Native readers now authenticate even empty catalogues, check the complete item
  set and refuse deleted items reappearing against verified history. Web verifies
  the signed deletion catalogue payload. Local deleted details/tabs are cleared;
  web popouts close and Desktop detail windows clear their cached values.

## Evidence gathered

- Core: 19 tests passed; browser binding: 1 test passed.
- Native CLI: 88 tests passed, 1 pre-existing live TLS/PostgreSQL fixture test
  explicitly ignored. New regressions cover exact retry, reopened encrypted queue,
  sibling preservation, peer-edit conflict, authenticated empty state and refusal
  of stale/unauthenticated deletion state.
- Web: 78 tests passed. Desktop: 37 tests passed, including deletion confirmation,
  captured owning vault and stale response refusal. The full mixed run exposed an
  outdated Desktop fixture that omitted the still-displayed item; it was corrected
  and a separate verified-absence regression added. Desktop suite rerun passed.
- Server unit/HTTP suite passed; the new database test is opt-in. A separate actual
  PostgreSQL 17 run of `apps/server/test/private-vault.pg.test.mjs` passed using real
  Rust WASM, HTTP, signatures, transactions and checkpoint verification. It proved
  migration preservation, invalid-signature rollback, sibling ciphertext identity,
  exact receipt replay, stale refusal and rejected recreation of a deleted ID.
- Web and Desktop type/build checks passed. Native/Core/browser strict clippy and
  formatting checks passed; generated WASM was rebuilt from the changed Core.

The database run used a new disposable container,
`127vaults-item-delete-20261016-a`, port 12941, with memory-backed data. It was
stopped afterwards. No retained release fixture or queued request was modified.
These are focused product checks, not a claim of physical GUI/manual acceptance.

## Remaining release work

1. Build new server/web, Windows/Linux Desktop and CLI packages from the committed
   implementation. Prior server-b, Desktop-e and CLI-b lack this feature.
2. Verify package manifests and run basic packaged deletion/reader sanity on
   disposable synthetic content. Check schema-7 upgrade handling for the server
   package; do not downgrade or overwrite retained installations.
3. Update the selected inventory and readiness decision with the resulting
   evidence, and commit those changes locally without pushing.

Physical/intended-host acceptance remains the user's separate follow-up. The
earlier unexplained Windows launcher policy rejection remains uninvestigated;
no bypass or new extension/passkey permission grant was attempted.

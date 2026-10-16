# Required individual-item deletion — implementation checkpoint

The user requires item deletion for internal release. The implementation now
spans Core/WASM, the server, native client/CLI, Desktop and web/PWA. The user subsequently waived installer rebuilds when the feature is tested
locally. Local feature acceptance is complete under that criterion; older
server/Desktop installers remain explicitly outside this acceptance.

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
- Web: 79 tests passed. Desktop: 37 tests passed, including deletion confirmation,
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

## Acceptance and deferred builds

The user's latest instruction is: “no need to rebuild installers if the feature
is tested locally.” The source feature and focused checks satisfy that criterion.
The extra PWA rebase regression uses real Core ciphertext to verify unchanged
rebasing and preservation of peer edits until explicit server/deletion choices.

The already-started CLI internal-20261016-c builds completed for Windows and
Linux at feature commit 8d95a85; both manifests verified. The packaged Windows
binary's item-delete help also passed. No new server/Desktop build was started
after the user waived rebuilds. The earlier server attempt was terminal on a busy
release-cache lock and produced no package. No active build remains.

Server/web-b and Desktop-e remain historical packages without deletion. Rebuild
and packaged deployment sanity are deferred follow-ups, not conditions of this
local acceptance. Schema-7-to-8 dry-run/apply was exercised against the actual
fresh PostgreSQL fixture, independently of installer rebuilds.

Physical/intended-host acceptance remains the user's separate follow-up. The
earlier unexplained Windows launcher policy rejection remains uninvestigated;
no bypass or new extension/passkey permission grant was attempted.

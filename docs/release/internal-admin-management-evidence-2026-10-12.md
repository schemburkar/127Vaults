# Internal admin management evidence — 2026-10-12

Scope: isolated fictitious accounts on Windows, PostgreSQL 17 and headless Edge.
This verifies the internal control-plane write slice. It does not accept a
supported real-secret release, external security review or a clean second host.

The [management contract](../architecture/internal-admin-management.md) defines
the distinct local operator and enrolled vault-account identities. Schema 6 is
unchanged; schema 7 adds suspension, admin roles, ownership grants, receipts and
redacted audit. No existing installation was migrated during this work.

## Recorded checks

- `node scripts/admin-directory-smoke.mjs --management --browser` passed using a
  new in-memory PostgreSQL container and the production store/HTTP handler.
  A populated schema-6 dry run rolled back, and the real 6→7 migration preserved
  account, device, session and encrypted authentication material.
- Store acceptance covers operator permission restrictions, last-owner refusal,
  suspended-session rejection by `PgAuthStore`, seat accounting, idempotent
  request replay, divergent ID refusal, device revocation, invitation
  creation/revocation, stale recipient authentication and accepted ownership.
  Concurrent owner demotions accept only one action and retain one active owner.
- `admin-management-handler.test.mjs` passed: operator authentication, exact
  Origin, CSRF, body limits and a fresh password are required before dispatch.
  Passwords do not enter mutation receipts or denial audit parameters. Ownership
  acceptance uses the recipient's own authenticated session and rejects caller-
  supplied account identity.
- The Edge walkthrough passed suspension/reactivation, ownership request/cancel,
  invitation creation, empty password after submission, invitation-code removal
  on close, audit display and a 390px viewport using real PostgreSQL actions.
- `VAULTS_TEST_OWNERSHIP=1 node scripts/pwa-browser-smoke.mjs` passed the production
  React recipient confirmation flow with real Rust/WASM unlock in its isolated
  protocol fixture. Acceptance clears unlocked state and requires another login.
  That fixture also passed offline restart, queued edits, conflict review,
  lost-response replay and archive/restore/move recovery.
- The existing 137-account admin browser regression and PostgreSQL directory
  check passed after the new suspension filter was introduced.
- Workspace `pnpm check` and `pnpm test` passed. Live PostgreSQL checks above are
  separate from the default test runner's explicitly skipped integration rows.
- The schema-7 `internal-20261012-c` extracted server package passed verified
  HTTPS invitation create, identical replay, divergent request-ID refusal,
  revoke and audit redaction. Its encrypted database/identity backup, guarded
  empty-project restore, second-restore refusal and existing-owner read passed.
  Evidence is retained in `C:\Projects\127Vaults-internal-recovery-20261012-f`.
- The exact release image passed populated schema 1→7 migration, encrypted
  pre-backup, dry-run rollback, lock contention and checksum verification.

## Release boundary

The schema-7 packaged recovery drill and Windows/Linux native backend checks
now pass. Installed desktop GUI and the full extension browser/site/source
matrix remain open in the [internal release gate](internal-release-readiness-2026-10-12.md). Management
writes are loopback-only. Private-LAN console access remains refused. Secret
settings, restore, migration, shutdown and licensing stay in operator runbooks.

# Server administration polish — 2026-10-10

SRV-016 remains **Partial**. The local operator console now supports a useful read-only inspection flow; reviewed account-management writes and deployment acceptance are still open.

## Visible changes

- Search all accounts and devices, replacing the previous latest-100 cutoff. Filter by account role/enrollment status or device lifecycle/protection/credential state, sort records, change page size and jump directly to a page.
- Inspect full account/device IDs, timestamps, verification and credential state in a keyboard-accessible dialog. Copy an ID or use the selected manual-copy fallback. Open an account's devices and return to the full inventory.
- Inspect invitation recipients by email, inviter or record ID, with pending/expired/revoked/redeemed filters and creation/expiration/recipient-state details. Multi-recipient records keep recipient-specific states; redemption takes precedence over later expiry or revocation. Tokens, verification codes and activation links are excluded.
- Use overview review links for pending/expired recipients, active devices needing rotation/stale-credential review, unknown device protection and unknown backup freshness. Overview account/device links reset earlier directory filters.
- See loading, empty, retained-but-stale, incompatible-response, timeout and retry states. Expired sessions clear all displayed directory data. Failed sign-out stays visible until confirmed, and obsolete requests cannot dismiss a newly authenticated session.
- Sign in with password visibility, Caps Lock feedback and a retry countdown supplied by the server. Failed attempts retain the operator name and clear the password. The header shows server identity, role and session time remaining.
- Use labeled record cards on narrow screens, with visible details actions, section links, skip-to-content, keyboard focus restoration and native dialog Escape behavior.

## Local verification

`pnpm check` and `pnpm test` passed across the repository. Server checks additionally cover the new admin modules and fixture scripts. Admin tests cover query validation, parameterization, response-shape validation, authorization/CSRF, no-store responses, retry timing, expiry, escaping, safe metadata selection and rollback cleanup.

`node scripts/admin-directory-smoke.mjs` passed against PostgreSQL 17 in a new loopback-only container with in-memory storage. The fixture installed the real schema and 137 accounts/devices, exercised every page, equal-timestamp ordering, literal `%_` searches, case-insensitive email/ID searches, filters and sorting, account-scoped devices, page clamping, multi-recipient invitation states and secret-field exclusion. A second connection revoked a device between count and row reads: the read-only repeatable-read response retained 35 consistent active devices and the next request saw 34. The fixture container was removed afterward.

`node apps/server/scripts/admin-browser-smoke.mjs` passed in installed headless Edge with the real admin handler and synthetic database rows. It verified 137-record pagination, search, sorting, page jumps, account/device/invitation dialogs, review links, clipboard success/fallback, server outage/retry, malformed-response recovery, sign-out failure, old-request isolation, API and local-timer expiry, password entry/cooldown, a real 15-second request deadline/retry, both owner/admin operators and 1440/390/320-pixel layouts. The narrow layout includes a 64-character operator name and retains accessible table semantics.

The browser fixture routes synthetic HTTPS requests to an isolated loopback HTTP handler. It verifies application behavior and served CSP/assets; it does not establish real deployment certificate/Host/SNI acceptance. It never reads `.env`, live operator files or a live database. Screenshots are optional local outputs under `VAULTS_ADMIN_SCREENSHOTS`; they contain synthetic metadata only.

## Limits and next acceptance

The console uses file-configured local operator credentials, separate from vault-account enrollment. It remains loopback-deployment-only and read only except sign-in/sign-out. Account suspension, invitation resend/revocation, role/ownership changes, device revocation, settings writes and audit workflows require the planned authorization/fresh-auth/audit design. Backup creation/restore remain operator runbook operations; unknown freshness is not reported as healthy.

Target-host HTTPS, real operator configuration, supported-browser manual use and clean-install acceptance remain open. These checks do not close crypto review, real-secret readiness, the restore/upgrade wave or multi-device vault acceptance. See the [administration guide](../product/server-admin.md), [directory contract](../architecture/server-admin-directory-contract.md) and [server backlog](../product/server-backlog.md).

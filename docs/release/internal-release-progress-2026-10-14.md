# Internal release progress — October 14, 2026

**Decision: internal release remains unaccepted.** This continuation closes
specific local gaps without converting the remaining physical/manual or broader
cross-client gates into passes. The earlier restart checkpoint and sync matrix
remain applicable; this report records subsequent work.

## Closed local gaps

- CLI `sync-review` exposes the existing Desktop pending-review engine through
  the unlocked CLI agent. It lists durable queued titles, operation identifiers
  and changed field names, separately reports settings pending/conflict state,
  and neither uploads queued writes nor exposes field values. Connector agents
  refuse this management action. Regression coverage verifies byte-for-byte
  queue preservation and exclusion of username, website, password and custom
  values with an unavailable network.
- Private-vault capacity now reports `LIMIT_EXCEEDED` instead of invalid input;
  native clients explain the five-vault limit rather than reporting encryption
  failure. The core regression creates five vaults, refuses a sixth and verifies
  every existing vault remains decryptable. The cap and retained data are intact.
- PWA lifecycle monitors subsequent `updatefound`/worker state changes, as well
  as an already waiting worker. A persistent installed-app notice explains save,
  close-all-windows and reopen. It never forces activation or reload beneath an
  editor. Listener cleanup covers asynchronous registration and unmount.

## Checks and browser evidence

`pnpm check`, `pnpm test`, workspace Rust tests, Rustfmt and strict workspace
Clippy passed. After changes, web build/type checking and the two update-monitor
regressions passed; CLI library has 71 passes and one intentionally ignored live
fixture test. Core has 18 passes. The separately run
`node scripts/device-management-smoke.mjs --rust` passed real pinned-CA HTTPS,
PostgreSQL enrollment/approval/possession/replay/revocation, account isolation,
session and audit checks. It removed only its own disposable database container.
`node scripts/mvp-acceptance.mjs dev --check` passed startup preflight.

Actual Chromium/WASM/IndexedDB/Cache Storage/service-worker acceptance passes at
`C:\Projects\127Vaults-pwa-cache-upgrade-20261014-c\evidence.json`.
`VAULTS_TEST_CACHE_UPGRADE=1 VAULTS_TEST_CHAINED_QUEUE=1` selects the repeatable
mode of `scripts/pwa-browser-smoke.mjs`. It downloads a differently versioned
shell, verifies the previous worker/cache remain while a window is open, saves
an encrypted offline edit, closes the last window, verifies automatic activation
and old-cache retirement, reopens offline and unlocks the retained queue. It then
explicitly syncs and resolves divergence, preserving the queued edit and chained
creation identity. Broader existing settings/archive/restore/move/lost-response,
tamper and ordinary-browser-online-only checks also pass in that run.

This is an isolated HTTP fixture with installed display-mode emulation, **not**
physical installation or packaged PostgreSQL/TLS acceptance. Two preceding
attempts failed a harness assertion expecting background "Sync needs attention"
after a new page opened; the final run uses explicit interactive Sync and waits
for its conflict dialog. Neither failed run is counted as acceptance.

## Still required

Latest Windows packaged GUI manual launch/acceptance; Windows active-session and
actual web-source extension acceptance; native lost-response injection and wider
deleted-item/create-collision/multi-queue/settings/default-view lifecycle; real
PWA installation and intended-host CA/enrollment; physical lock/idle and clean
physical Windows/Linux acceptance. Passkey-site permission/ceremonies remain
pending. See the expanded sync matrix for exact scope.

Public-site tests/catalogue validation pass as part of the workspace suite. Its
commercialization/public distribution remains outside this private internal cut;
no download is published and no beta claim is added. Server/admin and extension
source code did not change in this continuation.

The previously rejected Windows GUI launch and unanswered fixture-origin website
permission are preserved boundaries. No alternate launch route or permission
grant was used. No remote push occurred. Packaging and latest-binary runtime
evidence must be recorded separately before selecting these new source changes.

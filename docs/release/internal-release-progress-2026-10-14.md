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
actual web-source extension acceptance; wider
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
grant was used. No remote push occurred.

## Immutable packages and additional real-server evidence

Source changes are committed as `ee83e2d1363fccdd4d031e6cf3cd928b1ef7d361`.
New selected private candidates, with complete file-set/SHA256 verification:

| Product | Label/platform | Evidence |
| --- | --- | --- |
| Server/web/admin | `internal-20261014-e/linux-amd64` | Fresh packaged HTTPS, encrypted owner/item hostile paths, audited admin invitation writes and receipt replay, encrypted database/identity backups, guarded combined restore and pre-backup owner/item read pass |
| Desktop | `internal-20261014-b/windows`, `linux` | Installer builds, Desktop tests, native library checks and framed connector discovery pass; fresh Ubuntu dependency/GUI/package lifecycle pass |
| CLI | `internal-20261014-c/windows`, `linux` | Library/build/native framing, actual keyrings, pending review, capacity refusal and bidirectional native reply-loss recovery pass |
| Extension | retained `internal-20261014-a/chromium`, source `07fdca5` | No extension source change; retained installed Linux GUI-source matrix remains applicable |

The [checksummed inventory](internal-release-artifacts-2026-10-13.json) selects
these six sets. Bundles are unsigned private candidates, not full acceptance.
New server image is `localhost/127vaults-server:release-0dc28085d495ac4b`.
The persistent 12892 sync fixture still runs the earlier `server-bundle-d` image;
the new bundle was exercised separately at 12894 with new fictitious identities.
Do not silently treat the sync fixture as upgraded.

Native reply-loss evidence:
`C:\Projects\127Vaults-native-lost-response-20261014-c` (Windows writer/Linux
peer) and `...-d` (Linux writer/Windows peer), each with `native-evidence.json`
and `proxy-evidence.json`. The fixture-only TLS proxy uses the original verified
CA/certificate and exact loopback origin. It consumes a successful real
PostgreSQL write response before closing the connection. The peer reads the
accepted title, makes a newer edit, and the writer restarts its agent and retries.
Proxy hashes, request IDs and signed-operation IDs prove the exact request is
resent and returns the original successful receipt. Both peers retain the newer
title/username, redacted password and empty final item queues/conflict lists.
Settings pending/conflict flags are recorded separately. `sync-review` on each
writer verifies the durable queue without exposing values or altering requests.

The first two proxy attempts could not authenticate upstream (SNI/container
network routing), so native unlock fell back offline and queued a draft. Those
drafts were subsequently synced intact; their generic replay helper's expected
old-title assertion failed after successful sync, so they are not counted as
lost-response passes. The helper now requires successful online device listing
before creating the loss-test edit. The final proxy shares only the owned
backend network, uses empty SNI for the literal-IP endpoint and verifies the
certificate's loopback hostname. All runs restored the original fixture port;
only its original server/database are left running and healthy.

Both packages also refuse a sixth vault with the new clear capacity message and
unchanged directory/queued-review metadata. Windows first encountered a peer
settings-review prerequisite; the guarded helper confirmed no local settings
draft and the expected server vault name before explicitly accepting the server
settings. It then passed capacity refusal. No setting draft was discarded.

Fresh package/runtime evidence:

- `C:\Projects\127Vaults-internal-clean-client-20261014-a\evidence.json`: fresh
  Ubuntu 24.04 container dependencies, actual WebKit GUI trust form, standalone
  CLI/native framing and package remove/reinstall preserving a profile marker.
- `C:\Projects\127Vaults-sync-server-20261014-d\evidence.json`: seven passing
  fresh server/admin/backup/restore phases. Its first predecessor `...-c` failed
  in the owner smoke and remains retained; the original helper discarded stderr,
  so the cause cannot be established from that run. A replay against the partly
  consumed bootstrap is not a fresh-owner test. The helper now retains private
  failure diagnostics outside Git without printing token-bearing assertions.
  The fresh rerun passes; no server product fix is claimed from this harness work.

These runs add concrete local evidence while leaving latest Windows GUI,
actual extension web-source, broader settings/type/multi-queue UI and physical
acceptance gates open. Selected Desktop GUI code is unchanged; fresh package
startup does not replace the enrolled Windows/Linux walkthrough.

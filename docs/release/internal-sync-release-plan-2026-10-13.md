# Internal release and cross-client sync verification

**Decision: not accepted for internal release; sync verification is open.**

The user's expanded goal covers server, web/PWA, Windows and Linux desktop/CLI,
Chromium extension and admin management writes, including synchronization between
them. Commit completed work to local Git main; do not push. Preserve existing data
and exact queued ciphertext. Existing passing evidence is a subset, not acceptance
of the complete workflow. Never discard user edits to make a test pass.

## Current failures and investigation

| Case | State and evidence | Remaining verification |
| --- | --- | --- |
| Existing development database fails new server startup | Backed up and migrated recognized schema 6 to 7; server/database healthy and web/admin verified HTTPS HTTP 200 | Existing-profile sync after upgrade, not merely server startup |
| Desktop unlocked but extension reports locked | Old October 9 registered native host reported inactive; rebuilt host reported the same agent active; registration updated preserving extension ID | Live Edge popup reconnect, unlock/lock and restart with the installed source |
| Unlocked web tab not recognized by extension | Active vault tab was excluded from selection; fixed and three selection regressions pass | Actual unlocked web source, permissions, reconnect and multiple-tab selection in Edge |
| Compare resubmits failing queued requests | Dedicated verified read-only comparison; HTTP tests prove no queued POST and unchanged pending request on failure | Actual user queue and successful field resolution, not only synthetic failure tests |
| Review loses owning vault or operation context | Dialog now captures owning vault and passes it to compare/save/discard; stale missing operation gives an actionable error | Multiple-vault navigation and actual queued operation resolution |
| Missing server item described as a field conflict | In progress: distinguish unsynced creation from absent edited item; do not offer nonexistent server fields | Classification, preservation, explicit discard and safe stale-create retry |
| Multiple stale queued creations repeatedly rejected | Reproduced on real schema-7 PostgreSQL/TLS fixture: two rejected creations chose an unaccepted pending predecessor. Fix excludes quarantined operations and refreshes verified heads between rebases. Fresh rerun and preserved failed-queue recovery reach zero pending/conflicts; peer reads both exactly once. | User queue and packaged/client-pair matrix remain open |
| Offline creation followed by an edit becomes stranded | Reproduced after the first fix: rebase replaced the item ID and reused an old batch snapshot. Fix preserves the ID and refreshes the replica between operations. Exact chained scenario now reaches zero pending/conflicts with edited fields and original ID on peer. | Broaden to field conflicts, lost responses, collision and additional edits |

## Required acceptance matrix

For each enabled client pair (web/PWA, Windows/Linux desktop and CLI; extension
through each supported source), verify creator-to-reader and reader-to-creator.
The server transports ciphertext; admin operations affect authorization and
ownership rather than decrypting item contents. Tests must preserve that boundary.

| Scenario | Release requirement | Current state |
| --- | --- | --- |
| Online create/update and enabled item types | Exact fields read by another client, secrets masked until requested | Subset passed; complete matrix open |
| Offline edit/create, process restart and reconnect | Durable queue, exact replay, eventual verified peer read | Subset passed; existing-profile and all-pair coverage open |
| Lost response and repeated retry | Idempotent receipt, no duplicates or dropped changes | Subset passed; broaden to actual clients |
| Reconnect after multiple peer checkpoints | Verify the intervening checkpoint chain without falsely rejecting valid progress | Reproduced and fixed in native engine; real-server fresh unlock passes after two missed checkpoints, packaged/UI matrix open |
| Concurrent nonoverlapping changes | Both changes retained after rebase | Engine/subset evidence; UI matrix open |
| Same-field conflict | Correct item/vault/operation, masked comparison, selected-field save and peer verification | Packaged fictitious subset passed; reported user failure remains open |
| Server copy and missing server item | Explicit decision, only selected edit retired, other queue unchanged; no invented copy | In progress |
| Stale create, create-ID collision and chained pending edits | New item remains recoverable; predecessor chain and new causal base valid | Root-cause investigation open |
| Vault/collection/default-view changes | Reviewed divergence refreshes all clients without losing pending items | Vault/collection subset passed; full settings matrix open |
| Archive/restore/move/ownership changes | Correct visibility and queue behavior after peer/admin changes | Subset passed; full client matrix open |
| Revocation/expiry/OS lock and extension source handoff | Clear reason, no secret exposure or false unlocked state; pending work preserved | Subset passed; physical and live-source cases open |
| Upgrade and selected release packages | Existing encrypted profiles survive; all components use compatible versions | Critical installed-host mismatch found; full upgrade acceptance open |

## Evidence and completion rules

Record the exact source revision, artifact/profile/server identities, client pair,
steps, expected/actual outcome and evidence path for each run. Label source tests,
simulated HTTP, real encrypted engine, actual UI and packaged runtime separately.
No aggregate green status substitutes for an untested row. Keep failed reproductions
and narrow diagnoses; do not call a symptom fixed until its original path passes.

The October 12/13 evidence reports remain historical subset evidence. The release
can be accepted only when this matrix and the intended-host installation/trust/admin
gates are verified, with every exception explicitly reviewed. Real-secret readiness,
public distribution and signing remain outside this internal fictitious-data cut.

## New engine evidence

`apps/cli/examples/internal_sync_matrix.rs` accepts only absolute enrolled fictitious
profiles bound to installation `14725fef-f5b4-4cb8-afe0-77aa3d80b268` and distinct
devices. It uses actual encrypted requests, TLS, PostgreSQL and peer reads. Linux
runs use the separate fictitious keyring; no real profile was modified.

| Case | Evidence | Outcome |
| --- | --- | --- |
| Two stale creations before fix | `/home/vaults-dev/vaults-sync-matrix-20261013-a` | 409, two pending/conflicts, neither title on peer; both drafts retained |
| Same scenario after predecessor fix | `...-b/stale-creations-after.json` | Both peer items, zero pending/conflicts |
| Original failed queue recovered | `...-a/recovered.json` | Both peer items exactly once, zero pending/conflicts |
| Chained create/edit before identity fix | `...-c/chained-before.json` | One edit stranded; original ID not preserved |
| Chained create/edit after identity/snapshot fix | `...-d/chained-after.json` | Original ID and edited title preserved; both items on peer; zero pending/conflicts |

These are source-engine evidence, not yet packaged UI or a complete all-client pass.

Windows independently enrolled a new fictitious peer on its own OS keyring and
passed the same chained stale-create/edit scenario with stable identity and zero
pending/conflicts: `C:\Projects\127Vaults-sync-matrix-20261013-b\chained-windows.json`.
The extended actual Edge/PWA fixture also passes chained creations/edits, offline
restart, conflict review, lost response, signed history/checkpoints, settings and
vault lifecycle: `C:\Projects\127Vaults-sync-pwa-20261013-a\evidence.json`.
Run it with `VAULTS_TEST_CHAINED_QUEUE=1`; its HTTP fixture is distinct from the
native PostgreSQL/TLS matrix. Both use real Rust cryptography and disposable data.

Windows real-server tests also pass selected-field conflict resolution and taking
the server title while preserving an independently queued password update:
`C:\Projects\127Vaults-sync-matrix-20261013-b\fields.json` and `server-copy.json`.
Seven enabled non-passkey types pass bidirectional fields and disclosure checks
using two live sessions: `...\types.json`. These are engine tests, not all-client
rendering or the separate passkey ceremony gate.

All six new candidate directories are file-set/SHA-256 verified and built from
`8aeaf9b`: server `internal-20261013-a`, desktop `internal-20261013-e`, CLI
`internal-20261013-c`, extension `internal-20261013-b`. The artifact inventory is
explicitly marked candidate-only. Windows package-extracted UI queue acceptance is
prepared at `C:\Projects\127Vaults-sync-desktop-20261013-a`; automatic approval review
rejected its launch as "blocked by policy" without a further reason. Approval of
that exact isolated fixture launch was explicitly granted by the user. The retry
was nevertheless rejected by automatic approval review with the same reason.
It has not been reported passed; do not substitute engine tests for this UI gate.

The user confirmed that both original queued Desktop changes now sync successfully.
This closes the reported two-change queue reproduction, not the complete matrix.
Windows-to-Linux-to-Windows native engine field synchronization passed for all seven
enabled non-passkey types, including redacted reads and explicit secret disclosure:
`C:\Projects\127Vaults-sync-matrix-20261013-b\cross-os-types.json`.

Native history loading previously refused any vault with more than 500 operations.
The source now collects bounded pages before the existing signature/checkpoint
verification and replica commit. Regression tests cover 502 rows, read-only loading,
stalled/mismatched cursors and changed device verification keys. Windows library
checks pass 67 tests with one separately gated live-device test ignored; workspace
Clippy passes. The real-server stress run reached revision 499 before the core's
1,000-envelope session budget stopped further encryption. Its queue/data were
retained. Fresh online unlock and decrypted body read subsequently pass with 546
verified operations, zero pending and zero conflicts:
`C:\Projects\127Vaults-sync-matrix-20261013-b\history-read.json`.
The full 502-write stress scenario is not counted passed. Session-limit messaging
and recovery acceptance remain open; the fixture now restarts every 100 writes.

The retained stress item subsequently completed revisions 500 and 501 after a
fresh unlock. Fresh verified history/body read sees cursor 548, original item ID,
revision 501 and zero pending/conflicts: `...\history-resumed.json`. This proves
502 item operations across sessions, not unlimited encryption within one session.
Native item writes now check that both index/body encryptions fit the unchanged
core budget before consuming either slot, returning an explicit lock/unlock/retry
message instead of the generic encryption error. Core budget/decrypt regression
coverage preserves the 1,000-envelope bound and existing ciphertext readability.
Packaged/UI acceptance of this limit remains open.
Linux independently opens the same real-server history and reads the final item
body at cursor 548 and revision 501: `...\history-linux.json`. The fixture searches
all active vaults instead of assuming that per-profile vault ordering is identical.

Two peer-created checkpoints while the original client was disconnected caused
fresh native unlock to falsely report a fork. Failed evidence:
`C:\Projects\127Vaults-sync-matrix-20261013-b\checkpoint-before.json`.
Hydration now fetches bounded checkpoint-history pages from the pinned anchor,
verifies every signature, predecessor and operation head, and reaches the latest
checkpoint before committing. The unchanged real-server reproduction passes:
`...\checkpoint-after.json`. Signed fork and wrong-head regressions still refuse.
Windows library checks now pass 68 tests with one live-device test separately
gated; workspace Clippy passes.

Desktop `internal-20261013-f` and CLI `internal-20261013-d` were rebuilt for both
platforms from `b7d2bb9`; they contain operation pagination but predate checkpoint
catch-up. They are intermediate candidates and must not be selected as accepted.
Rebuild after the remaining production fixes and refresh the selected inventory.

The rebuilt server bundle passed fresh identity/admin setup, verified HTTPS,
hostile owner/item paths, packaged admin sign-in and audited writes/replay,
encrypted database/identity backup, guarded empty-project restore and owner login
with existing encrypted items after restore. Evidence:
`C:\Projects\127Vaults-sync-server-20261013-a\evidence.json`. Its owned projects were
stopped afterward; the user's development server was not stopped or reset.

## Latest packaged command evidence

All six candidate directories were verified again and the artifact inventory now
selects Desktop `internal-20261013-g` and CLI `internal-20261013-e`, both platforms,
from `4224086`. They include operation pagination, missed-checkpoint catch-up and
the bounded-session diagnostic. Server `internal-20261013-a` and extension
`internal-20261013-b` retain their recorded `8aeaf9b` provenance. No public release
or complete matrix acceptance is claimed.

`scripts/internal-packaged-cli-sync.mjs` drives actual packaged CLI commands and
owned unlock-agent subprocesses with explicit enrolled fictitious profiles. It
does not change the active-profile pointer or native-host registration. Windows
creation, Linux read/edit and Windows return read pass against real TLS/PostgreSQL:
`C:\Projects\127Vaults-sync-cli-20261013-a\cross-os.json`.
The offline run confirms two creations plus a chained edit as exactly three durable
operations, stops the agent, advances the server from Linux, restarts Windows and
replays with stable item IDs and zero pending/item conflicts. Linux reads both
recovered IDs and edits the first; Windows verifies the peer edit:
`...\queue.json`. Both standalone CLI archives and Desktop-shipped CLI executables
were exercised. These are command/agent acceptance, not Desktop rendering.

Linux's existing fixture requires reviewed vault-settings refresh after peer
settings changes. Item queues and conflict markers are empty; that settings
review was preserved rather than silently accepted for a cleaner aggregate status.

The current Windows extension fixture reaches both unlocked native sources, but
the real Chromium idle API reports `idle` and the background's 30-minute policy
then sends lock requests before item listing. Failed popup diagnostics retain
request/response timings and that OS state:
`C:\Projects\127Vaults-sync-extension-20261013-a\browser-test-f\popup-failure.json`.
This run is not an autofill pass. The agents are stopped and the previous browser
registration and profile pointer restored. Active-session rerun is pending; the
idle policy has not been disabled or spoofed. Earlier short-lived fixture runners
also let their agents exit; the final runner keeps agents alive during the test.

After the user made the Windows session active, the current extension package
passed the complete installed popup/form matrix with the current packaged host:
`...\browser-test-g\evidence.json`. Linux independently passed the same matrix:
`/home/vaults-dev/vaults-sync-extension-20261013-a/browser-test-a/evidence.json`.
Coverage includes explicit fill without submit, new-password/ambiguous form refusal,
same-origin frame selection, shadow roots, React rerender, navigation refusal,
wrong-origin no match, native Desktop/CLI agent source handoff, browser restart
and source lock clearing. All native profiles and page credentials are fictitious.
The sources are actual protocol agents, not a claim that the separately blocked
Windows Desktop GUI launch or actual unlocked web-tab source has passed.
Both runs restored the prior registration/profile pointer and stopped their owned
agents. Physical OS-lock and optional passkey permission/ceremony remain open.

Linux packaged GUI queue acceptance reproduced a save/detail-reload race: the
first creation is durable, but clicking Edit while save still reloads the detail
can let that late reload overwrite the new editor. The failed profile remains at
`/home/vaults-dev/vaults-sync-desktop-20261013-a/profile` with its one queued creation;
no edit was discarded to pass a test. Evidence:
`C:\Projects\127Vaults-sync-desktop-linux-20261013-a\offline-create.json.failure-1791907863297.json`.
Edit, New item and Duplicate now refuse while saving and their buttons are disabled.
Desktop checks and 19 workflow tests pass, including the actual draft handlers'
in-flight-save guard. The GUI fixture also explicitly chooses the destination
vault and waits for the enabled Edit action. A new Desktop package/retest remains
necessary; existing `internal-20261013-g` packages predate this UI fix.

## Resumed verification — October 14

Desktop `internal-20261013-h` for Windows/Linux includes the save/reload guard,
builds from `41e5ba9`, and passes package checks and complete checksum verification.
The selected inventory now records these packages instead of `g`.
The new Linux package passes real GUI offline creation, a chained edit and a
second creation with three durable operations: `...sync-desktop-linux-20261013-a\offline-b.json`.
The original IDs are retained in `...\queue-b-identity.json`. After Windows CLI
advances the server, Linux Desktop restarts, explicitly verifies Online connection
and clears the queue; `...\replay-b.json`. Windows standalone CLI reads both
original IDs exactly once, validates titles, empty ordinary fields, default password
redaction and explicitly revealed fictitious passwords. The identity evidence
records `ui-peerPassed` and an empty peer item queue.

The previous replay timeout checked for two item titles inside the single-item
detail pane rather than the item list. The corrected harness checks item-list
buttons. On resume, the fixture server was stopped, which also exposed an overly
broad Online text check matching "Online unlock failed". The harness now requires
the Profile panel's exact Connection value. That misleading intermediate result
is retained as `...\replay-b.invalid-online-assertion.json` and is not acceptance.
Only the owned fixture server was restarted; the user installation was untouched.

Next gates remain Windows packaged Desktop GUI, actual web/PWA-to-native pairs and
unlocked web-tab extension source, the wider settings/authorization/lifecycle matrix,
optional passkey permission/ceremony and physical OS-lock/intended-host acceptance.
Windows fixture launch was explicitly approved but automatic review rejected it
as "blocked by policy" without a further reason. Do not bypass that rejection or
claim the full internal release accepted.

### Trusted browser enrollment and web/native round trip — October 14

The current packaged server (`release-89b4c7bf9bce5a15`, source `8aeaf9b`) is now
running against the owned fixture's existing PostgreSQL volume and TLS identity,
installation `14725fef-f5b4-4cb8-afe0-77aa3d80b268`, at HTTPS port 12892. Only
fixture bundle port/manifest metadata changed. The original runtime bundle remains
retained; the user's installation and Windows trust store were untouched.

A fresh Chromium browser enrolled through the actual web UI. The packaged Windows
CLI owner approved its exact device ID/public-key fingerprint; browser approval
and OPAQUE unlock passed. The fixture CA is trusted only inside an isolated Linux
browser container, with no HTTPS bypass. Its enrolled nonextractable identity
survives browser restart.

`scripts/internal-web-native-sync.mjs` and the `web-peer` phase of
`scripts/internal-packaged-cli-sync.mjs` pass the actual online round trip:
web UI creates an encrypted item; Windows packaged CLI reads its original UUID,
checks ordinary fields, redaction and explicitly requested fictitious password,
edits title/username; web UI reloads, displays those values with password masking,
and locks. Evidence: `C:\Projects\127Vaults-sync-web-20261014-a\web-native.json`,
item `3909498f-1da1-43df-9b97-dfb8d8a3d2dd`. This is an online login-item pair,
not acceptance of PWA offline replay, all enabled types or conflict resolution.

An initial test clicked Next before asynchronous identity initialization completed.
The identity itself was retained. Startup now disables account actions, and the
Next handler waits for readiness; the regression also checks that enrollment can
still open the password step while its completion is busy. All 62 web tests and
web build/type checks pass. This startup fix is source-level evidence and still
requires a new server/web package before replacing the selected inventory.

Remaining: Windows packaged GUI manual launch/test; live unlocked web-tab extension
source including multiple tabs; web/PWA-native offline/conflict/type/settings matrix;
wider authorization/lifecycle/revocation; optional passkey ceremony; physical OS-lock
and intended-host acceptance. The full internal release remains unaccepted.

The trusted PostgreSQL/TLS web/native fixture also passes an offline PWA creation:
Chromium network is disabled, the UI reports a pending encrypted edit, reconnection
replays it, Windows packaged CLI reads the original UUID and password and edits it,
and the browser reads the peer edit. `internal-web-native-sync.mjs --offline`
retains a per-item evidence file as well as the current coordination file. The
installed display mode is emulated; this is not physical PWA installation or
process-restart/conflict acceptance. Initial evidence is retained separately in
`...sync-web-20261014-a\pwa-native-first.json`; the repeated committed-helper run
writes `web-native-<itemId>.json`. The broader offline/conflict matrix remains open.

### New packaged server/admin and concurrent PWA conflict finding

Server `internal-20261014-b` is built from clean committed `de3f854`, immutable
image `localhost/127vaults-server:release-ba261b5e3bcebf00`; all six selected release
file sets/checksums are verified. The mutable legacy `internal-20261014-a` bundle
is retained as a build experiment and is not selected. The new immutable package
passes fresh installation, trusted HTTPS, owner/hostile item paths, packaged admin
sign-in/audited writes/replay/sign-out, encrypted database and identity backup,
guarded restore into a new empty project and pre-backup owner/item read after
restore: `C:\Projects\127Vaults-sync-server-20261014-b\evidence.json`. Its own
containers stopped; original cross-client fixture remains running separately.

The live PWA/native concurrent-edit gate reproduced a product bug: PostgreSQL sync
returns HTTP 409 `base_changed`, while PWA conflict recovery recognized only
`BASE_CHANGED`. The local edit survives restart but review does not open. The wire
code is now normalized at the browser API boundary without widening other 409
refusals; 63 web tests and checks pass. This newer fix is not in package `b`.
The original pending item `6027e4b8-bd0a-4c1c-a1a2-cad8f0f31531` and its browser
profile remain preserved in `...sync-web-20261014-a`. Recovery validation is still
open because another pre-review error remains after this normalization. Do not
accept this gate or discard its queue to force a passing result.

### Concurrent PWA edit recovery verified on the rebuilt package

The apparent additional pre-review failure was the fixture's existing service worker
still serving the old browser module. A source diagnostic confirmed loading the
updated module, then recovered the original preserved queue by merging the server
title with the local username. No item/identity/replica database was removed. This
intermediate source-only check is superseded by the packaged reruns below.

Server `internal-20261014-c`, clean source `1c244ad`, immutable image
`release-6540e03233c5047b`, includes the wire-error fix. It replaces `b` in the
verified inventory. Only the owned cross-client fixture was upgraded; its existing
installation ID, database and TLS identity remained. Without source replacement,
actual PWA UI / real PostgreSQL-TLS / Windows packaged CLI now pass:

- Concurrent offline edit → Merge field by field → server title + local username,
  zero pending; original item `94adf452-661a-4f30-95d9-cc0dff8b89fb`. Windows and
  Linux packaged CLI independently validate the merged fields, redaction and the
  explicitly requested fictitious password.
- Concurrent offline edit → Use server version, zero pending; original item
  `afb5dcb9-ff8a-4150-9369-0884370fdeea`. Linux packaged CLI validates server fields
  and password. Per-item files `...sync-web-20261014-a\web-native-<itemId>.json`
  retain the browser outcome; the CLI `web-verify` phase records peer verification.

These PWA tests emulate installed display mode. Actual PWA installation, cache
upgrade UX, all enabled item/custom-field types, lost responses with independent
native peers and physical OS lock remain separate gates. The browser fixture now
returns the live lower-case item-conflict code so its larger regression scenario
cannot hide this mismatch again. Full internal release acceptance remains open.

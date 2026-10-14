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

## Settings, multiple conflicts and consecutive edits continuation

**Internal release remains unaccepted.** New selected CLI
`internal-20261014-e/{windows,linux}` and Desktop
`internal-20261014-d/{windows,linux}` are built from
`aca13d81224b2719f9e3df7db7ca3d2cdf3dc176`. These supersede the native labels
in the preceding table. Server/web/admin `internal-20261014-e`, source `ee83e2d`,
and extension `internal-20261014-a`, source `07fdca5`, are unchanged. All six
complete artifact sets/SHA256 checks were reverified in the committed inventory.
Intermediate CLI-d/Desktop-c packages lack the consecutive-edit fix and remain
reproduction artifacts rather than selected candidates.

Two applicable native blockers were found and fixed:

- `370b554`: CLI server-copy resolution now refreshes verified server state
  before retiring the selected draft. Failed refresh and offline refusal retain
  both selected and unrelated queues. Success retires only the selected conflict.
  Desktop already used this sequence. HTTP regressions cover read-only refresh,
  two preserved drafts, offline refusal and independent retirement.
- `aca13d8`: consecutive online native edits previously reused the cached
  device predecessor after a successful write. The second peer edit in a real
  two-item scenario returned HTTP 409 and remained queued. Successful TLS
  receipts now update an in-memory signing-head hint; verified hydration
  replaces it from server history. Pending non-conflicted operations still take
  precedence. The item baseline is not refreshed underneath a reviewed edit,
  and no checkpoint history is fabricated. HTTP regression verifies consecutive
  PUT predecessors with no intervening GET, then verifies a later 409 retains
  the reviewed catalogue/item baseline. Broader acknowledgement/rollback and
  checkpoint-window acceptance remains an audit gate.

Strict workspace Clippy, Rustfmt and CLI library checks pass (72 tests plus the
separately gated live test). Windows/Linux CLI and Desktop immutable builds run
their relevant library/frontend/native framing gates. Later test/harness-only
changes do not alter the selected `aca13d8` production source.

### Settings and pending-item isolation

`C:\Projects\127Vaults-settings-matrix-20261014-b\evidence.json` verifies
four cases: each OS writer with explicit server or local settings choice. Each
case passes ten phases through CLI-c/source `ee83e2d`, real keyrings and the
retained TLS/PostgreSQL fixture. An offline default-view change and one existing
synthetic item edit survive an agent restart. A peer default-view change creates
real settings divergence. Read-only review and either settings resolution leave
the exact item request unchanged; explicit Sync later sends that item, and the
peer verifies both decisions. Original view behavior and item fields are restored.
Names, collections and removal preference remain intact. This does not close
GUI settings/default-view or all collection/removal cases.

The first harness cleanup compared unset default versus explicit All literally;
both select all items. The retained `...-a` attempt was corrected and restored,
then the four-case `...-b` matrix completed. An intermediate case hit the real
10-logins/minute account limit and safely fell back offline before mutation.
Remaining phases were paced within that limit; no rate limit was changed.

### Independent real conflicts and recovery

`C:\Projects\127Vaults-multi-conflict-20261014-a\evidence.json` verifies
both OS writer directions using CLI-e/source `aca13d8`. Two offline overlapping
edits produce two real conflicts after competing peer writes. Comparison retains
both drafts, an offline server-copy attempt refuses with both intact, verified
server-copy resolution retires one while preserving the other's exact encrypted
pending record/conflict, and explicit local-copy resolution sends the second.
Peer reads verify the independent choices and unchanged password. Both synthetic
items are restored; final queues/conflict lists are empty.

The initial Windows-writer queue was produced by CLI-d/source `370b554`; that
package's Linux peer hit the consecutive-edit defect. Its pending ciphertext was
saved as `windows.json.peer-pending-before-recovery.json`, synced intact, and
the preserved Windows queue was completed with CLI-e. `windows-before-aca.json`
retains the intermediate evidence. The reverse Linux-writer case is fresh on
CLI-e throughout. No test marker was inserted and no draft discarded to pass.

Latest-package reply-loss retests pass at
`C:\Projects\127Vaults-native-lost-response-20261014-e` (Windows writer) and
`...-f` (Linux writer): exact retry hashes/IDs, peer's newer title retained and
empty item queues/conflicts. They supersede the earlier native package evidence
for this specific scenario. Every owned proxy/server-port change was restored;
the original bundle-d server/database are healthy on 12892.

### Actual Linux GUI and public site

Latest Desktop-d passed actual Linux WebKit DOM/React/native-backend online
unlock, two creations and repeated existing-item edits without intermediate Sync.
Windows CLI-e reads the final two items exactly once and verifies masked and
explicit password output. Evidence:
`C:\Projects\127Vaults-sync-desktop-linux-20261014-b\online.json` and
`peer.json`. The separate Linux GUI profile is copied from the retained fixture;
the original profile/package and user development installation are preserved.
The GUI was locked and only its owned process stopped. Windows GUI launch and
physical keyboard/screen-reader acceptance remain pending.

`C:\Projects\127Vaults-public-site-20261014-a\evidence.json` records actual
Chromium rendering of all 11 static pages at widths 1440 and 390, local-link and
image checks, no document overflow, closed intake controls, cloud-seat estimates
and no published download links. All API responses are locally closed; no write,
contact request, email, payment, account or publication occurs. Physical
accessibility, public hosting and commercial/legal gates remain separate.

Repeatable checked-in helpers now include
`internal-packaged-settings-sync.mjs`, `internal-packaged-multi-conflict.mjs`,
`internal-public-site-smoke.mjs`, and Desktop driver's `online-consecutive` mode.
Saved external runners select the exact original identities and keyring setup.
The broader sync/type/lifecycle/authorization, actual extension web source,
latest Windows GUI and physical acceptance gates remain open. Nothing was pushed.

## Durable acknowledged writes and latest native candidates

CLI-f (`1a00c62`) and Desktop-g (`762296c`) supersede the earlier native
candidates. All six selected artifact file sets passed manifest, size and SHA256
verification; the inventory records each product's actual source revision.
Server/web/admin and extension candidates are unchanged.

Native replicas now retain a durable acknowledged-operation pin until a verified
server history includes that operation. Hydration rejects missing acknowledged
operations, rewrites of previously verified history and a mismatched local-device
signing key before replacing the local encrypted replica. Verified hydration
clears pins. CLI status reports actual online/authenticated state and the safe
verification-refusal reason. Desktop presents verification failures and retained
acknowledgements without suggesting an acknowledged copy can be discarded.

A delayed item read could overwrite an editor opened before that read completed.
All edit/new/duplicate entry points now invalidate the old request. Actual-handler
regressions cover those three draft races and save verification feedback.
CLI library checks passed (75 plus one deliberately ignored separate live test),
strict workspace Clippy/Rustfmt passed, Desktop build/type/native checks and all
24 Desktop tests passed. The separate Rust device-management HTTPS/PostgreSQL
fixture passed enrollment, approval, possession, replay, revocation, isolation,
session and audit checks. Windows/Linux package build and framing gates passed.

Packaged CLI acknowledgement acceptance passes both OS writer directions at
`C:\Projects\127Vaults-acknowledgement-20261014-a\evidence.json`. The owned TLS
proxy captures genuine authorized encrypted bodies, operations and checkpoints
before a real successful write, then replays that older snapshot. It never rolls
back the database or forges signatures. Both clients refuse the missing operation,
keep the encrypted replica byte-for-byte across process restart, expose the
acknowledged item offline and recover when current history resumes. Independent
peer reads pass; original fixture values are restored.

Actual Desktop-g Linux DOM/React/native-backend acceptance passes at
`C:\Projects\127Vaults-desktop-acknowledgement-20261014-c\evidence.json`:
verification failure remains visible, sync review reports one retained
acknowledgement without a discard choice, lock/offline restart preserves the
exact replica, current history clears the pin, and original title is restored.
The original owned server mapping was restored. Earlier failed runners are
retained separately and are not counted as passes. The GUI helper now waits for
the selected item's loaded heading before editing and waits for initial rendering.
An earlier helper edited another controlled lifecycle fixture before its requested
item loaded; that fixture was restored and independently verified by Windows CLI.

Seven typed items (login, password, bank, card, Wi-Fi, router, SSH) passed actual
Linux GUI edit/restore at
`C:\Projects\127Vaults-sync-desktop-linux-20261014-c\typed.json` (Desktop-f).
`typed-peer.json` independently verifies the original IDs, types, title/ordinary
fields and masked/explicit standard, custom and related secrets through Windows
CLI-f. This is an existing-item roundtrip, not full typed creation/lifecycle or
Windows GUI acceptance. Earlier untargeted repeated-item results are superseded
by the corrected Desktop-g roundtrip in the acknowledgement matrix.

Internal release remains unaccepted. Latest Windows GUI, physical installation,
OS-lock/keyring/CA ceremonies, broader cross-client lifecycle/type/queue cases,
and actual extension web-source acceptance remain separate open gates. Completed
changes are committed to local main; no remote push or public deployment occurs.

## Actual packaged desktop and web archive/restore

Desktop-g Linux (`762296c`) now passes actual Settings → Vaults archive/restore
against the original retained TLS/PostgreSQL fixture (server source `103da5b`).
The helper identifies the exact controlled vault by its stable displayed code,
checks its fixture name and explicit archive choice, then verifies its Restore
action. It reviews current server settings only after proving there is no local
pending settings draft. Windows CLI-f independently observes the archived flag,
refuses an item write, and after GUI restoration verifies the original title,
username, website, masked password and explicit password. Both GUI phases lock
normally; the item and settings queues finish empty. Evidence:
`C:\Projects\127Vaults-desktop-lifecycle-20261014-a\evidence.json`, with separate
`archive.json`, `restore.json` and `native-evidence.json`.

The selected server/web-e runtime image (`ee83e2d`, image ID
`8caae90f069a8d91d29a29b520f7c22b722bb08a80e3b177bf0b7f2bf448eddc`)
also passes actual Chromium settings archive/restore with independent Windows
CLI-f archived-write refusal and restored field/password verification. This
uses the existing owned database and installation identity, and a separately
copied enrolled browser profile. It does not enroll a new installation, reset
history or remove the original browser profile. Evidence:
`C:\Projects\127Vaults-web-lifecycle-20261014-b\evidence.json`, with web phase
records and native peer records.

The first web runner's source bundle listened internally on 12894 while the
retained browser authority is 12892; authority validation correctly returned
forbidden before unlock. That failure is retained in workspace-a. Workspace-b
copies the selected bundle and changes only fixture Compose listener/mapping
12894→12892, recording the override and recomputed fixture Compose checksum.
The selected immutable image and release inventory are unchanged. The original
owned server bundle/image and bundle environments were restored after the test.
These passes establish this controlled archive/restore client pairing; Windows
GUI, move/ownership, interrupted lifecycle and physical acceptance remain open.

## Packaged Desktop concurrent merge and missed checkpoints

Desktop-g Linux (`762296c`) now passes an actual offline title-only edit,
process exit/lock, competing Windows CLI-f (`1a00c62`) username edit, then
online restart and explicit GUI **Sync now**. Both edits survive without a
conflict, the item queue is empty, the secret stays masked, and the independent
Windows peer verifies both fields and explicit password. Original fields are
restored and checked independently by both clients. Evidence:
`C:\Projects\127Vaults-desktop-nonoverlap-20261014-a\evidence.json` and separate
GUI phase/CLI records. The first read attempt assumed unlock itself replayed
queued writes; its retained failure does not establish a product defect.
The corrected step explicitly clicks Sync now and preserves the original queue.
Settings flags are recorded separately: the peer had no pending settings draft
but did report a settings conflict during this test; item convergence does not
establish settings acceptance.

A separately cloned stale Desktop-g profile also passes real online restart
and GUI sync after missing three genuine server checkpoints. The Windows
packaged peer creates checkpoints via controlled vault archive/restore, accepts
reviewed server settings only after proving no local draft, and restores the
vault. PostgreSQL read-only metadata proves the stale checkpoint was sequence
4 and latest sequence 7 (cursor 70). GUI hydration advances to the latest verified
checkpoint; original title/username remain readable with secret masked, and
pending/conflict/acknowledgement lists are empty. Evidence:
`C:\Projects\127Vaults-desktop-checkpoints-20261014-a\evidence.json`, original
`replica-before.json`, resulting `replica-after.json`, `reconnected.json` and
signed checkpoint records in `native-evidence.json`. Source fixture server is
`103da5b`; this is not a claim about a different server package or Windows GUI.
The first producer assertion incorrectly expected restore to sign a checkpoint;
only archive does. It left the controlled vault restored. The corrected producer
uses two archive/restore cycles; the stale profile misses those two plus the
checkpoint created before that failed assertion. Existing history is preserved.

These actual UI checks close the selected Linux GUI concurrent non-overlap and
multiple-missed-checkpoint cases. Windows GUI, other client pairings and broader
history/lifecycle/queue cases remain open. Original server/database are healthy;
no external account, remote push or public deployment is involved.

## Packaged Desktop independent two-conflict decisions

Desktop-g Linux (`762296c`) now passes actual GUI review and independent choices
for two overlapping conflicts in one controlled vault. Packaged Linux CLI-f
(`1a00c62`) produces the two genuine offline drafts in a separately copied GUI
profile; Windows CLI-f independently changes both corresponding server items.
The original profiles and earlier fixture evidence are preserved.

The actual GUI Sync now classifies both conflicts. Review sync identifies each
correct title and owning vault; Compare and select fields shows both local/server
versions while masking the password. Lock/process exit leaves both pending signed
requests byte-for-byte unchanged. A fresh GUI process chooses Use server version
for the first item. The second pending request, operation ID and conflict remain
unchanged exactly. Another GUI restart explicitly chooses Use mine for the second
item after verified comparison, ending with zero pending item operations and
conflicts. Windows CLI independently verifies the selected first server title and
second local title, default password redaction and unchanged explicit password.
Both original synthetic items are restored and independently checked.

Evidence: `C:\Projects\127Vaults-desktop-multi-conflict-20261014-a\evidence.json`,
with separate `compare.json`, `server.json`, `local.json`, CLI phase records and
before/reviewed/server/local/restored encrypted replica snapshots. Server fixture
source is `103da5b`; the source/package/UI scopes are recorded explicitly. Queue
creation uses the real packaged CLI, while review/resolution uses actual packaged
Linux DOM/React/native handlers. This does not establish GUI queue creation,
Windows GUI or multiple-vault navigation/queue acceptance. Helper syntax checks
and Git whitespace checks pass. Original server/database remain healthy. These
completed evidence changes are committed to local main without a remote push.

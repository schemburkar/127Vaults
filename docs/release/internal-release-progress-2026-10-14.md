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

## Seven enabled types created through the packaged Desktop UI

Actual Desktop-g Linux (`762296c`) now creates login, password-only, bank,
card, Wi-Fi, router and SSH items through New item, the type picker, the explicit
fixture destination selector, field controls and Save. The test fills every
primary ordinary/secret field, including bank account/PIN, card number/CVV/PIN,
network settings and SSH host/port, plus supported username/website/password
fields. After each save the actual detail view shows the expected type and
ordinary fields and masks all secrets; the final queue is empty and Lock clears
the decrypted session. No direct native invocation or fabricated item is used.

Windows CLI-f (`1a00c62`) independently discovers each unique original item ID,
verifies the exact type marker and field set, default secret redaction and
explicit standard/primary-secret outputs. It edits all seven titles. A fresh
packaged GUI process reads every peer-edited item with unchanged fields and
secret masking. Windows CLI then verifies those versions and restores baseline
titles. Item and settings queues/conflicts are empty in both CLI phase records.
The seven newly created synthetic fixtures are retained for later acceptance.
Evidence: `C:\Projects\127Vaults-desktop-typed-create-20261014-a\evidence.json`,
separate GUI `create.json`/`read.json`, original IDs and native phase records in
`native-evidence.json`. Source fixture server for this native pairing is `103da5b`.

Selected packaged server/web-e (`ee83e2d`, unchanged immutable runtime image)
independently reads all seven original Desktop-created IDs after restoration.
Actual Chromium DOM checks prove the correct displayed type, exact ordinary
fields, usernames/websites and masking of standard/primary custom secrets;
Lock clears the browser session. Evidence:
`C:\Projects\127Vaults-web-desktop-types-20261014-b\evidence.json` and
`web-gui-created-read.json`. Workspace-a retains the first field/masking pass;
workspace-b adds explicit displayed-type assertions. This uses separately copied
enrolled browser profiles and the existing trusted identity/database. The retained
fixture bundle only adjusts its listener/mapping 12894→12892; the selected image
is unchanged. Original bundle/image and environment were restored after each run.

Helper syntax and Git whitespace checks pass. These passes establish actual
Linux GUI creation → Windows CLI read/edit → Linux GUI read, and Desktop-created
items → selected packaged web read, for these seven types. They do not establish
Windows GUI creation, physical trust/keyring acceptance, passkey ceremonies,
offline typed combinations or every other client pairing. Internal release
remains unaccepted; completed checks/evidence are committed to local main without
pushing or publicly deploying.

## Actual Desktop selected-field merge with another queued conflict

Desktop-g Linux (`762296c`) now passes explicit per-field choices while a second
conflict remains queued. In a separately copied profile, packaged Linux CLI-f
queues title/username edits on two controlled items; Windows CLI-f independently
writes different titles/usernames. Actual GUI review compares both versions
without changing either pending signed request and masks passwords.

For the first item, the driver clicks the server Title and local Username radio
options, waits for their actual `aria-checked` states, then clicks Save selected
fields. The GUI shows the server title plus local username. The second pending
request and its conflict remain byte-for-byte unchanged. A fresh GUI process
explicitly chooses the remaining local version after verified comparison, ending
with zero item queue/conflicts. Windows CLI independently checks both resulting
titles, usernames, unchanged websites, default redaction and explicit password.
The original fields of both synthetic items are restored and independently read.

Evidence:
`C:\Projects\127Vaults-desktop-field-merge-20261014-a\evidence.json`, with actual
GUI `compare.json`, `server.json` (selected-field phase), `local.json`, native peer
records and before/reviewed/selected/local/restored encrypted replicas. Native
packages are CLI-f/source `1a00c62`; retained fixture server is source `103da5b`.
Queue creation uses packaged CLI; choices/save use actual packaged Linux
DOM/React/native handlers. Helper syntax and Git whitespace checks pass.
Original server/database remain healthy. This closes the selected-field Linux
GUI/Windows CLI case, not Windows GUI, multiple-vault queues or other pairings.
Internal release remains unaccepted, with completed changes committed on local
main and no remote push.

## Cross-vault review and displayed-item owner fix

The first actual Linux Desktop-g cross-vault run passes two drafts in distinct
controlled vaults, read-only comparison, selected server/local decisions, exact
preservation of the other vault's pending request and Windows peer verification.
Its evidence is retained at
`C:\Projects\127Vaults-desktop-multi-vault-20261014-a\evidence.json`.
Workspace-b adds sidebar navigation to the opposite vault before each review.
Its first wait expected a queued local title in the ordinary browse list, while
that list correctly showed the verified server title. The helper now accepts
those two expected representations. The corrected comparison passed; its original
failed diagnostic and pending profile remain separate and unchanged.

A subsequent actual-handler regression reproduced an additional P1 context bug:
opening automatic sync review or Review sync reassigned `itemVaultId` to the
conflict owner while leaving a different displayed item selected. Cancelling
could therefore leave that displayed item's next save aimed at the wrong vault.
Commit `68b16ea3e09cf6cb01e1e23cfa695e8b0f2d2d82` preserves the displayed item's
binding when opening review. Conflict actions retain their captured owning vault;
accepting a server copy explicitly passes that owner to the detail reload.
Two actual-handler tests failed on the original code and pass on the fix; a third
verifies the explicit server-copy reload owner. This did not deliberately write
an unrelated item to another vault to demonstrate the bug.

Desktop type/build/native checks and all 27 Desktop tests pass. New immutable
Desktop-h Windows/Linux packages are built from that committed revision and pass
locked dependency, frontend/native check, Desktop tests, CLI library tests
(75 plus one intentionally ignored separate live fixture), optimized builds and
framed native-host discovery. All six selected artifact file sets, sizes and
SHA256 sums verify; the inventory selects Desktop-h. CLI-f, server/web/admin-e
and extension-a remain unchanged. Older packages are retained.

Actual Desktop-h Linux reruns the preserved two-vault queue from a separately
copied pending profile. Before each item review it navigates to the opposite
vault. Both versions show with password masked and exact queue preservation.
Selecting the first verified server copy retires only that draft; the other
vault's request and conflict remain byte-for-byte unchanged. A fresh GUI process
selects the remaining local version. Windows CLI-f verifies the results,
unchanged websites/usernames and explicit password; original synthetic fields
are restored. Final item queues/conflicts are empty. Evidence:
`C:\Projects\127Vaults-desktop-multi-vault-20261014-c\evidence.json`, actual UI
phase records, native peer records and both-vault encrypted replica snapshots.
The preserved workspace-b/profile-j reproduction was not discarded or synced;
workspace-c/profile-k performs recovery. Source server fixture remains `103da5b`.

This closes the selected Linux GUI cross-vault review/isolation case and the
confirmed owner-binding bug. Windows GUI and other recorded release gates remain
open; internal release is not accepted. Original server/database remain healthy.
Completed changes are committed to local main without a remote push.

## Latest packaged Desktop accepted-write reply loss

Actual Desktop-h Linux (`68b16ea`) now passes save/lock/process restart and receipt
replay after a real server accepts the GUI write but its TLS reply is lost. The
owned response-loss proxy forwards/authenticates against the original trusted
HTTPS/PostgreSQL fixture and destroys only the first successful selected PUT
reply. The GUI retains one encrypted pending signed request. Lock closes only
the fixture-created redundant editor state; it does not discard the durable queue.

Before GUI reconnect, Windows CLI-f (`1a00c62`) independently reads the accepted
GUI title and writes a newer title/username. A fresh actual GUI process explicitly
syncs the original request, ends with zero pending/conflicts/acknowledgements and
reads the newer peer title/username with password masked. Proxy evidence records
three successful PUTs: original GUI write, distinct peer write and receipt replay.
The third request's complete body SHA256, request ID and operation ID exactly
match the first. It does not generate a replacement write or overwrite the peer.
Windows CLI independently verifies the newer version and explicit password.
Packaged Linux CLI restores original title/username/website, and Windows peer
verifies restoration. Final queues are empty.

Evidence: `C:\Projects\127Vaults-desktop-loss-20261014-b\evidence.json`, actual
GUI `write.json`/`replay.json`, `proxy-evidence.json`, original encrypted queued and
replayed replicas and native peer/restoration records. Source fixture server is
`103da5b`; all product/package/client identities are recorded. The initial runner
in workspace-a failed its fixture guard before editing because it lacked the
baseline record. Workspace-b uses the previously verified restored item record;
the failed attempt is retained and is not counted as a pass. Original server
mapping, database and identity were restored after both attempts and are healthy.

Helper syntax and Git whitespace checks pass. This closes the selected latest
Linux GUI lost-response/restart/peer preservation case. Windows GUI, broader
multi-queue/pair loss cases and other recorded gates remain open. Internal release
remains unaccepted. Completed checks/evidence are committed to local main without
pushing or publicly deploying.

## Selected packaged PWA acknowledged-history rollback acceptance

Actual installed-mode Chromium/WASM/IndexedDB against selected server/web-e
(`ee83e2d`) now passes a genuine successful acknowledgement followed by replay of
older authorized encrypted/signed responses. The existing PWA projects each
queued signed operation into encrypted local history and retains that operation
after its accepted queue entry retires. This serves as the durable acknowledgement
pin: its remote-history validation refuses the older history before replacing
records. No product change was needed for this case.

The actual UI displays Item saved; refresh needs attention and Sync needs
attention. After the acknowledgement, the queue is empty and the accepted
operation remains in local history. An explicit Sync attempt under older replay
preserves the entire encrypted records object byte-for-byte. Resuming current
server responses recovers the acknowledged title with secret masked and the
operation in current verified history. The original title is restored and the
browser locks. Windows CLI-f independently verifies the original title,
username/website, default redaction and explicit password. Evidence:
`C:\Projects\127Vaults-pwa-acknowledgement-20261014-c\evidence.json`, separate
`web-evidence.json`, genuine signed snapshot/proxy record, accepted/refused
encrypted records and native peer record.

This is installed-mode emulation, not a physical PWA installation. It uses a
separately copied enrolled fictitious browser profile, clears only its copied
asset/service-worker caches, and preserves encrypted IndexedDB state and the
original profiles. An existing queue is refused before authentication unless the
explicit recovery mode validates exactly one controlled fixture operation. The
selected runtime image is unchanged; its retained fixture Compose adjusts only
the listener/mapping 12894→12892. Original database/identity are not rolled back.

Workspaces-a/b preserve failed fixture runs. The original proxy assumed the native
`/checkpoint` URL; the first adaptation guessed the wrong plural URL. Actual web
source uses `/checkpoint?history=1`. Those two proxy assertions happened after
upstream acceptance and accidentally lost the reply. In each case the PWA retained
the exact request, then the explicit controlled recovery mode replayed its receipt
against current history and restored the original title without resetting or
clearing the queue. Both `queue-recovered.json` records are retained. The proxy
now recognizes the actual native and web routes and validates snapshot readiness
before forwarding a selected write; a bad test setup receives a diagnostic 503
before any upstream mutation. Failed attempts are not counted as rollback passes.

Helper syntax and Git whitespace checks pass. Original server/database are
healthy after restoration. This closes the selected PWA acknowledged-history
case; broader checkpoint/fork windows, physical trust/permission and other
recorded release gates remain open. Internal release remains unaccepted.
Completed evidence/helper changes are committed to local main without a push.

## Latest Windows manual fixture preparation and seven-surface audit

The pending Windows manual starter was still selecting an older package. The new
`tests/internal/desktop/prepare-windows-desktop-fixture.mjs` verifies the selected immutable
Desktop-h Windows release (`68b16ea`), statically extracts its installer with
7-Zip, copies the guarded fictitious profile and prepares the human-run starter.
It never launches/installs Desktop or changes native registration. The starter
pins extracted binary SHA256, `app-k`, `profile-j`, `webview-k`, inspector12915 and
`app-k-pid.txt`. Original app/profile and starter are preserved separately.
All 12 copied profile files match their originals; generated PowerShell syntax
passes and the new PID file is absent. Evidence:
`C:\Projects\127Vaults-sync-desktop-20261013-a\manual-preparation-20261014-h.json`.
The first helper attempt created only empty staging directories before its strict
copy rejected a precreated destination; those directories are retained, and the
corrected helper uses fresh names without deleting or overwriting them.

[Seven-surface gate audit](internal-release-gate-audit-2026-10-14.md) consolidates
current evidence, selected revisions and missing acceptance. It does not convert
source, headless, container or Linux DOM/native-handler checks into Windows GUI
or physical acceptance. The manual Windows launch remains pending after automatic
approval review's earlier blocked-by-policy rejection. Fixture-origin web-source
extension permission and actual active Windows session are also unresolved.
The goal remains active and internal release unaccepted; other recorded automated
matrix cases remain applicable. Preparation/helper syntax and whitespace checks
pass; completed work is committed locally without pushing.

## Settings authorization refusal cannot report a successful online sync

A reproduced P1 native-state bug returned a successful `online: true` sync result
when item hydration succeeded but the subsequent encrypted settings read returned
401/403. Its settings error was wrapped as a partial pending result; the session
still claimed online/authenticated. The real Session/local HTTP regression failed
with that exact successful JSON result on the original code.

Commit `fba2cb203cbcfc4c81008c871def05ab37da4e52` marks the native session offline
on settings read/upload authorization refusal, retains the safe refusal reason,
and makes overall sync fail instead of claiming online success. Encrypted local
copies and pending drafts are retained. Replica status exposes the reason, and
Desktop applies its authoritative connection fields with generation checks.
Legacy responses without those fields do not invent an offline state.

The real encrypted HTTP transport regression covers read and upload 401/403,
compares the pending settings file byte-for-byte and distinguishes a 503 partial
settings failure from authorization loss. Three actual Desktop-handler tests
cover live offline status/pending count, stale-session isolation and legacy
response compatibility. All 76 CLI library tests (plus one intentionally ignored
separate live fixture), 30 Desktop tests, strict workspace Clippy, Rustfmt and
Desktop type/frontend/native checks pass.

New immutable CLI-g and Desktop-i Windows/Linux packages are built from the
committed fix. All build/test/native-host framing gates pass, and all six selected
artifact file sets/sizes/SHA256 sums verify. The inventory now selects those
native packages; server/web/admin-e and extension-a are unchanged. The reviewed
Windows manual starter now pins Desktop-i `app-l`, copied `profile-k` and
`webview-l`; old package/profile/starters are preserved and no GUI is launched.
Preparation and generated PowerShell syntax checks pass.

Actual packaged Windows CLI-g and Linux Desktop-i also pass mid-session refusal
over the retained pinned TLS/PostgreSQL fixture. A guarded proxy first verifies
upstream authorization, then injects 401/403 only for settings. Healthy CLI agents
become offline/unauthenticated, remain locally unlocked and keep their settings
file exactly unchanged. Actual Linux GUI Sync shows the offline reason and sync
failure; Lock clears the decrypted session. Evidence:
`C:\Projects\127Vaults-settings-authorization-20261014-a\evidence.json`, separate
`cli-401.json`, `cli-403.json`, `gui.json` and authorized refusal metadata.
No permanent fixture device was revoked and no settings write was forwarded by
the injected-denial branch. This proves packaged response handling, not actual
administrative revocation or physical Windows GUI acceptance. Pending encrypted
draft preservation is established separately by the transport regression.
Original server/database/identity and loopback mapping are restored and healthy.

This closes the confirmed false-online authorization bug. Internal release remains
unaccepted; human-dependent and other recorded matrix gates remain open. Completed
fixes, helpers, selected manifests and evidence are committed to local main without
pushing.

## User-requested stop checkpoint

The user asked to stop within ten minutes because usage may run out. A final
settings resolution P1 was reproduced and fixed in source commit `a65ab45`:
both choices authenticate and revalidate the reviewed server settings before
changing the encrypted pending record; access refusal and changed review retain
local work. Final source checks: CLI 78 passed/1 separately gated live test
ignored; workspace strict Clippy and formatting passed. Selected native packages
remain CLI-g/Desktop-i at `fba2cb2` and need fresh builds and actual packaged
resolve-time race/refusal evidence. Full reproduction, next actions and remaining
seven-surface/manual gates are saved in
[the stop checkpoint](internal-release-stop-2026-10-14.md). Internal release is
not accepted. Work pauses at the user's request, with no push.

## October 15 resumption

The user explicitly resumed the goal. [October 15 progress](internal-release-progress-2026-10-15.md) records fresh selected CLI/Desktop packages, four two-OS settings safety cases, actual Linux GUI refusal/newer-review acceptance, updated Windows static preparation and the corrected policy investigation. Internal release is still unaccepted; the goal remains active.

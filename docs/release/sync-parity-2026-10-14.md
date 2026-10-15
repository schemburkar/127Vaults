# Sync parity and release progress

Internal release is **not accepted**. This table distinguishes user-facing
capabilities from the exact evidence that still needs completing. Server stores
and verifies encrypted operations; extension delegates sync to its selected
unlocked source; admin manages authorization without decrypting vault items.

| Flow | Web/PWA | Desktop | CLI | Remaining gate |
| --- | --- | --- | --- | --- |
| Durable create/edit and reconnect | Selected web reads all seven Desktop-created types; real-server offline subset passes | Desktop-g Linux creates seven enabled types and reads Windows CLI peer edits; restart/replay subsets pass | CLI-f Windows verifies all seven GUI-created types and masked/explicit primary secrets; packaged queue subsets pass | Latest Windows GUI; other pair/type/offline combinations |
| Retry/lost reply | Real-server accepted-write/lost-reply/peer-edit passes | Desktop-h Linux actual accepted GUI save/reply loss, lock/process restart and exact receipt replay preserve newer Windows peer edit | New Windows/Linux packages pass both writer directions with exact retry and newer peer edit retained | Windows GUI; broader multi-queue/pair combinations |
| Non-overlapping changes | Implemented | Desktop-g Linux offline title + Windows CLI username converge through actual GUI Sync now; peer verifies both | Packaged Windows/Linux automatic merge passes | Windows GUI and other UI pairings |
| Review pending item/changed fields | Implemented | Desktop-h Linux reviews two owning vaults after opposite-vault navigation; displayed-item owner is preserved separately | Packaged `sync-review` reads durable queued metadata, masks values and preserves requests on both OSs | Windows GUI; broader queue UI |
| Verified read-only comparison | Packaged real-server pass | Desktop-h Linux cross-vault comparisons preserve both requests byte-for-byte and mask secrets | New Windows/Linux packages pass both directions | Latest Windows GUI; other UI pairings |
| Keep server/local | Packaged server-copy pass | Desktop-h Linux selected server copy preserves other vault's request exactly; second local decision reaches Windows peer | CLI-e verifies server before retirement; two-conflict independent server/local decisions pass both directions | Latest Windows GUI; other pairings |
| Selected-field merge | Packaged real-server pass | Desktop-g Linux actual server-title/local-username selection reaches Windows CLI; sibling request preserved exactly | New Windows/Linux packages pass both directions | Windows GUI; multiple-vault and other UI pairings; CLI selects custom-fields array as a group |
| Missing item / stale creation | Classification and replay implemented | Shared native engine and retained queues | Shared native engine | Deleted-item and collision matrix across UIs |
| Vault archive/restore | Selected packaged server/web actual settings archive/restore passes with Windows CLI peer | Desktop-g Linux actual settings archive/restore passes with Windows CLI peer | Packaged Windows/Linux archive propagation and read-only refusal; Windows normal/interrupted move with Windows/Linux readers pass | Windows GUI; other move writers/UIs, finalization-abort and ownership |
| Multiple missed checkpoints | Engine and source subsets | Desktop-g Linux stale process restart verifies three intervening real signed checkpoints from Windows CLI-f; PostgreSQL sequence proof | Packaged peer creates checkpoints and ends settled | Windows GUI; other pairings and larger chains |
| Source handoff/lock/reconnect | Web source bridge implemented | Actual Linux GUI-owned extension matrix passes | Linux agent-source matrix passes | Windows active-session and actual web-source extension |

Latest native candidates are CLI `internal-20261015-a` (source `600f206`) and
Desktop `internal-20261015-c` (source `4e1e146`); server/web remains `internal-20261014-e`,
source `ee83e2d`. The [October 14 continuation](internal-release-progress-2026-10-14.md)
records four packaged settings-choice cases preserving an unrelated item queue,
two-conflict isolation, consecutive native edit signing fixes, actual Linux GUI
repeated edits with Windows peer reads and latest-package reply-loss retests.
Authenticated older-history replay after a real acknowledgement now passes on
both packaged CLI operating systems, the actual Linux Desktop GUI and selected
packaged web/PWA (real Chromium/WASM/IndexedDB installed-mode emulation). The PWA
preserves its accepted encrypted records exactly and recovers current history.
Native evidence includes durable preservation, restart and recovery. Broader checkpoint-window rollback
and Windows GUI acceptance remain open. Seven native item types also passed Linux
GUI edit/restore with independent Windows CLI masked and explicit secret reads.

CLI now supports `conflict compare` and `conflict merge` with an explicit base and
field-source choices. Comparison redacts built-in/custom/related passwords and
preserves the exact pending request; merge uses verified versions internally.
Invalid/duplicate choices and absent-server-item merges are refused. Connector
read-only agents cannot invoke either action. New functionality's initial evidence
uses the rebuilt Windows debug CLI against the retained trusted TLS/PostgreSQL
server; immutable release packaging remains separate.

Real-server selected-field scenario: Windows queued an overlapping offline edit,
Linux changed both title/username, Windows compared the versions without altering
the queue, then selected server title and local username. Linux verified both
chosen fields, default redaction and unchanged explicit password. Final queues
and conflicts were empty. Evidence:
`C:\Projects\127Vaults-sync-web-20261014-a\lifecycle-native.json`;
earlier comparison-only evidence is retained in `lifecycle-cli-compare.json`.

See the [expanded evidence matrix](internal-sync-release-plan-2026-10-13.md),
[artifact inventory](internal-release-artifacts-2026-10-13.json) and
[restart checkpoint](internal-release-restart-2026-10-14.md). Keep committing locally
to main, preserve unrelated work and original queued operations, and do not push.

## Immutable CLI candidates and reverse-direction evidence

Windows/Linux CLI `internal-20261014-b`, built from committed
`b63e6e539653fa25b50a1e73cbb6b2cfef5691c3`, now supersede `internal-20261014-a`
in the selected inventory. Both builds passed 70 library tests (one separate live
fixture test ignored), optimized CLI/native-host builds and framed native-host
discovery. All six selected release file sets/checksums were reverified.

Both new packages passed actual TLS/PostgreSQL offline overlapping edits,
verified/redacted comparison with exact pending-request preservation, selected
server title/local username merge, and opposite-OS read/password verification.
Windows-writer evidence: `lifecycle-native.json`; Linux-writer reverse direction:
`lifecycle-packaged-linux.json`, under the retained web/native fixture workspace.
Both finish with empty item queues/conflict lists. Each record now separately
captures settings pending/conflict flags: empty item queues do not establish
settings acceptance.

Linux archive/restore to Windows also passed with archived-write refusal. Initial
Linux archive was refused because a newer peer settings revision required review.
The original encrypted settings record was copied to
`linux-settings-before-review.json`; there was no local pending settings draft.
`lifecycle-settings-accept` verified the reviewed server vault name and explicitly
accepted the server settings before retrying archive. No setting draft or existing
item was discarded. Broader settings divergence is still an open parity gate.

Current package extraction roots:
`C:\Projects\127Vaults-sync-cli-20261014-b\cli-package` and
`/home/vaults-dev/vaults-sync-cli-20261014-b/cli-package`. Both continue to use the
original guarded fictitious profiles. Saved runner `linux-lifecycle-b.sh` selects
the new Linux package and accepts an explicit second evidence-path argument.

## October 15 settings-review acceptance

[New continuation](internal-release-progress-2026-10-15.md): both selected CLI
operating systems pass server/local choices after resolution-time 401/403 and
changed remote revision, preserving real encrypted drafts and original item
queues. Original synchronized settings restored after all four cases. New
Desktop source closes stale review on refusal and refreshes connection status;
32 handler tests pass. Broader settings combinations and human-dependent gates
remain open. See the new continuation for packaged GUI proof and its limits.

## Isolated move subset — October 15

Selected CLI-a Windows writer passes normal move plus accepted copy/finalization
reply loss, durable journal/restart/exact replay and duplicate prevention, with
independent selected Windows/Linux CLI readers. Typed fields and secrets,
collection/default retargeting and retired-source behavior are verified on a new
TLS/PostgreSQL installation. [Detailed evidence and limits](isolated-lifecycle-2026-10-15.md)
retain the open UI/reverse-writer/abort/source-change/ownership/physical cases.

## Guarded move and authorization subset

Windows CLI-a move now passes changed-source/destination refusal, explicit abort
with copies retained, abort before receipt replay and later copy-only sync. A
new disposable device's real revocation preserves its journal and exact pending
request with truthful offline status; Windows/Linux peers still verify its signed
history and accepted copy. [Exact evidence and remaining scope](isolated-lifecycle-2026-10-15.md)
separate these packaged cases from UI/reverse-writer, ownership and physical gates.

## Linux writer and actual Desktop reader

Linux CLI-a move/finalization reply loss, restart, finalizing-stage abort refusal
and exact receipt replay pass with a Windows CLI reader. Selected Linux Desktop-c
reads the retained peer edit and explicitly reveals/remasks both secret types
through actual GUI/native handlers, then locks. [Lifecycle record](isolated-lifecycle-2026-10-15.md)
separates reader proof from still-open move UI and other pairing/ownership cases.

## Ownership software integration

[Selected ownership acceptance](ownership-acceptance-2026-10-15.md) now covers real
invited-account onboarding, request/cancel/accept, role/session/account isolation,
actual operator and customer browser controls, and real aged-session rejection /
customer guidance / fresh-unlock recovery. Original roles and catalogue restored;
selected CLI reads during demotion. Broader lifecycle/UI writer pairings and
physical/intended-host gates remain open; ownership is no longer wholly untested.

## Actual ordinary-web normal move

[Selected lifecycle evidence](isolated-lifecycle-2026-10-15.md) now also proves web
UI move confirmation/cancellation, one successful copy/finalization, retired source
without restore, field/password read/reveal and lock. A distinct registered device
independently decrypts original and copy. This covers a normal login subset using
the invited member; web fault/restart/custom/settings cases and packaged peer /
additional writer pairings remain open. Member directory is now nonempty; retain
its two entries and use the read-only verifier for the completed move.

## Actual ordinary-web accepted-copy reply-loss recovery

[Lifecycle evidence](isolated-lifecycle-2026-10-15.md) now also proves actual UI
Resume after full browser restart, retained encrypted journal/reserved ID, exact
copy receipt replay and unique-copy finalization after a discarded real HTTP200
copy reply. Independent registered-device decryption/counts and the retained
normal-move item ID pass. This is ordinary-web recovery with strict TLS; installed
PWA, finalization loss, divergence guards, typed/settings and additional packaged
peer/writer combinations remain separate.

## Actual ordinary-web finalization reply-loss recovery

[Lifecycle evidence](isolated-lifecycle-2026-10-15.md) now verifies discarded actual
finalization HTTP200, already-retired source, full-browser restart with exact final
journal, receipt-only Resume with same request ID/body hash and no copy POSTs.
Unique-copy UI fields/masking/reveal/lock and independent registered-device reads /
counts/prior IDs pass. Member directory now has four entries; use explicit current
reader mode. Divergence/abort policies, typed/settings, additional packaged peers
and physical/operational acceptance remain separate.

## Actual ordinary-web changed-source guard and cancellation

[Lifecycle evidence](isolated-lifecycle-2026-10-15.md) now verifies lost accepted
copy reply followed by a distinct device's real signed source edit, actual Resume
refusal with exact journal preservation/no copy-removal retry, and explicit cancel
preserving active source and historical copy. UI/independent-reader fields and
counts/prior IDs pass. Member has five retained slots; use guard reader mode and
preserve the completed/cancelled cases. Destination divergence, other abort /
authorization, typed/settings and remaining packaged/physical gates stay open.

## Selected server-a native-reader interoperability

[New native-reader evidence](server-a-native-readers-2026-10-15.md): selected Windows
and Linux CLI-a perform actual online sync/read with distinct owner devices, verify
fields/retirement/counts and secret masking/explicit access. Actual selected Linux
Desktop-c reads retained peer data, reveals/remasks both secret kinds and locks.
Binaries match selected archives; current server image is selected server-a.
This proves retained-owner reader/sync interoperability, not a new writer/member
CLI enrollment or physical/Windows/PWA/extension acceptance claim.

## New member web-to-packaged-CLI enrollment and move reads

[Selected-server evidence](server-a-member-cli-2026-10-15.md) now covers actual member
web approval of a fresh selected Windows CLI device, full binding comparison,
possession-proof completion and real native member reads of the web move / retained
peer edit. Selected admin UI management/security walkthrough also passes. This is
native member enrollment/read proof; additional OSs, writers, interruption and
physical/human review/intended-host combinations remain separate.

## Selected server-a: fresh Linux member CLI

Linux CLI-a now genuinely enrolls via member web approval and Secret Service,
independently reads the web-created valid move and preserved peer edit, then
locks/restarts its agent and authenticates/reads with its persisted key. This is
a distinct random device, not the seeded historical Node peer. Exact catalogue,
retirement, fields/password and empty review checked; no member writes or new
move claimed. [Evidence](server-a-linux-member-cli-2026-10-15.md). Private WSL
keyring is not physical clean-host acceptance; broader writer pairings remain.

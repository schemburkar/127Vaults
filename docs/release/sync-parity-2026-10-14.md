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
| Vault archive/restore | Selected packaged server/web actual settings archive/restore passes with Windows CLI peer | Desktop-g Linux actual settings archive/restore passes with Windows CLI peer | Packaged Windows/Linux propagation and read-only refusal pass | Windows GUI; move/ownership and interrupted lifecycle combinations |
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

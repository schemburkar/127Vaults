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
that exact isolated fixture launch is pending. It has not been reported passed.

The rebuilt server bundle passed fresh identity/admin setup, verified HTTPS,
hostile owner/item paths, packaged admin sign-in and audited writes/replay,
encrypted database/identity backup, guarded empty-project restore and owner login
with existing encrypted items after restore. Evidence:
`C:\Projects\127Vaults-sync-server-20261013-a\evidence.json`. Its owned projects were
stopped afterward; the user's development server was not stopped or reset.

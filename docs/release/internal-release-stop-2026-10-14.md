Resumed October 15 at the user's request. The rebuilds and packaged settings review cases below are now complete; see [new progress and remaining gates](internal-release-progress-2026-10-15.md). This stop checkpoint is historical.

# Stop checkpoint — October 14, 2026

Stopped within the user's requested ten-minute limit to preserve usage. Internal
release remains **not accepted**. Work is paused at the user's request. No remote
push, deployment, GUI launch or fixture mutation occurred in this closing turn.

## Completed before stopping

Commit `a65ab45dd8bb9ecd9020cb95e30df3e220b506c8` fixes a newly reproduced
settings-conflict safety defect shared by CLI and Desktop. Previously, choosing
the server copy trusted the earlier cached comparison, returned success and
cleared an encrypted pending local edit without any fresh authorization request.
The regression failed on the old implementation with `pending:false` and
`conflict:false`, despite a fixture prepared to refuse the next request with 401.

Both explicit choices now perform an authenticated, read-only settings fetch and
validate/decrypt the current envelope before changing local data. HTTP 401/403
marks the session offline and preserves the encrypted settings file byte for
byte. A changed revision/envelope preserves local pending work, updates the
in-memory server comparison and requires review again. The refresh does not
upload the pending edit. Unchanged reviewed settings still allow server adoption
or local resubmission through the existing conditional write path.

Validation on the final committed source: Windows CLI library suite **78 passed,
0 failed, 1 ignored**; the ignored live TLS/PostgreSQL test was not rerun in this
closing turn. Strict `cargo clippy --workspace --all-targets -- -D warnings` and
`cargo fmt --all -- --check` passed. Two real HTTP transport tests cover both
choices: six denied/changed-review cases, byte preservation and no writes, plus
two successful unchanged-review cases and the expected GET/PUT sequence. These
are source transport checks, not refreshed packaged-client acceptance.

## Immediate next work

1. Build fresh Windows/Linux CLI and Desktop candidates from committed `a65ab45`
   or a reviewed descendant. Current selected CLI-g and Desktop-i remain source
   `fba2cb2`; they **do not contain this latest fix**. Use unused labels (CLI-h,
   Desktop-j if still unused), keep previous outputs, verify manifests/hashes,
   then update the selected artifact inventory.
2. Exercise the settings review race/authorization refusal against the pinned
   real HTTPS/PostgreSQL fixture using those packages. Recheck ordinary explicit
   server/local choices, encrypted pending preservation and Desktop status/error
   rendering. Existing fault proxy and native/Desktop helpers are starting
   points; this new resolve-time scenario is not yet a packaged evidence claim.
3. Update Windows manual preparation to the new Desktop artifact/revision and
   fresh isolated paths. Existing reviewed manual starter remains Desktop-i at
   `C:/Projects/127Vaults-sync-desktop-20261013-a/start-isolated-desktop.ps1`
   (app-l/profile-k/webview-l, inspector 12915). Preserve it and original profiles.
4. Continue the explicit untested client/flow combinations in
   [sync parity](sync-parity-2026-10-14.md), including applicable lifecycle,
   deletion/collision and pairing cases. Do not infer all-pair parity from the
   completed subsets or empty item queues; settings convergence is separate.
5. Finish the human-dependent and operational gates in the
   [seven-surface audit](internal-release-gate-audit-2026-10-14.md): latest Windows
   GUI, physical clean installation/CA/keyring/OS lock, actual PWA enrollment and
   update, extension source permission/selection/reconnect, intended-host server
   and admin acceptance, and any applicable physical passkey ceremonies.

The audit and [progress log](internal-release-progress-2026-10-14.md) retain the
server/web/admin-e, extension-a and eleven-page public-site local evidence and
its limits. Nothing in this checkpoint waives their outstanding acceptance.
The owned 12892 fixture remains on bundle-d as previously recorded; no runtime
changes were needed for the local HTTP regressions. Existing profiles, queued
requests and failed reproduction artifacts must be preserved.

Automatic approval review previously rejected Windows GUI launch as “blocked by
policy.” No manual-launch/PID or extension-origin-permission response has arrived.
Do not work around that rejection with another launcher. Those gates remain open.
Commit completed changes to local main; do not push or mark the goal complete.

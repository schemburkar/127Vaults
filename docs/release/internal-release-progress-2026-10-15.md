# October 15 internal-release continuation

**Internal release remains not accepted.** The user explicitly resumed the goal.
The October 14 stop checkpoint remains historical; this continuation records new
work and does not waive the full seven-surface scope.

## New settings safety evidence

CLI `internal-20261015-a` Windows/Linux packages are built from committed
`600f206ce300e643a0b3d2dfd8259bdde597cb1a`, including the `a65ab45` settings
review revalidation fix. Both build gates passed 78 library tests (one separate
live TLS/PostgreSQL fixture ignored), optimized binaries and framed native-host
discovery.

Actual packaged Windows/Linux agents passed four settings-resolution cases:
each OS chose server and local. Every case first queued a real encrypted settings
edit through an authenticated PUT/503 fault; a distinct OS peer advanced the
real server settings revision. Explicit resolution under GET/401 and GET/403
failed, marked status offline/unauthenticated with encrypted local unlock retained,
and preserved the settings file byte for byte. Healthy restart retained the draft.
A further real peer revision made the old decision fail until comparison was
reviewed again. The updated explicit decision converged on the peer, and original
settings were restored after each case. Item queue values were unchanged; these
new profiles had no pending item edits. Earlier settings evidence separately
covers a nonempty unrelated item queue.

Evidence: `C:/Projects/127Vaults-settings-review-20261015-a/native-evidence.json`,
`native-refusals.json`, `baseline.json`, `verify-native.mjs` and `run.mjs`.
The native evidence pins both complete release manifests and file hashes. All
12 injected responses (four each of 503, 401 and 403) were issued only after real
upstream authentication. This is real pinned TLS/PostgreSQL with controlled fault
responses, not an actual administrative device revocation. The server runtime
remained the retained bundle-d source `103da5b`; selected server-e is unchanged.

Initial attempts failed before scenario mutation because Linux used the default
D-Bus/keyring, which did not hold the enrolled fixture device key. A dedicated
D-Bus session loaded the existing fictitious keyring. No key or profile was
replaced or re-enrolled. Failed attempts and environment snapshots are retained;
only the subsequent complete four-case run is claimed passed. Each runner restores
the exact server environment and original 12892 mapping in its finalizer.

## Desktop follow-through

Source commit `5312a349b45e2aa08c4daa5a823921748df7cf98` closes the old comparison
on a failed settings decision and refreshes connection status. Otherwise a newer
backend comparison could sit behind the still-displayed old choice, or denied
access could remain visibly online. The two real-handler regressions cover a
changed review and HTTP 403. Desktop suite: 32 passed. TypeScript/Vite/native
checks passed. The first Desktop-a rebuild from `600f206` is retained; the later
Desktop-b build includes this UI correction. Final artifact selection and GUI
acceptance are recorded below when verified.

## Launch-policy investigation

[The investigation](windows-launch-policy-investigation-2026-10-15.md) corrects
prior notes: the raw error establishes a pre-execution command rejection but does
not identify automatic review, a Windows policy or a user-configured rule. Current
config is approvals never, reviewer user and full filesystem access. No security
setting was changed and no alternate Windows launcher was tried. The exact
rejection reason and latest Windows GUI acceptance remain open.

## Windows preparation

The updated static Windows fixture is prepared from Desktop
`internal-20261015-b`, source `5312a34`. Manifest/file checks and PowerShell syntax
pass. The manual starter at
`C:/Projects/127Vaults-sync-desktop-20261013-a/start-isolated-desktop.ps1` now pins
extracted `app-m`, copied `profile-l`, separate `webview-m` and inspector 12915.
`manual-preparation-20261015-b.json` records installer/executable hashes. The prior
starter is preserved as `start-isolated-desktop.previous-20261015-b.ps1`, with all
older apps and profiles retained. No Windows GUI launch, installation, native
registration or security-settings change occurred.

## Completed package selection and actual GUI acceptance

Selected CLI is now `internal-20261015-a` on both OSs, source `600f206`; Desktop
is `internal-20261015-b` on both OSs, source `5312a34`. All six selected release
file sets and SHA256 sums passed verification, including unchanged server-e and
extension-a. Both Desktop build gates passed 32 tests, 78 CLI library tests with
one separate live fixture ignored, TypeScript/Vite/native checks, optimized
binaries, Windows NSIS, Linux DEB/AppImage and framed native-host discovery.
The two source revisions have no differences under `apps/cli` or `crates`.

Actual Linux packaged Desktop-b DOM/React/native acceptance passed two new cases:

- A mid-dialog settings GET/403 makes Keep server fail, closes the old comparison,
  reports failure, updates Profile to Offline with the authorization reason, keeps
  the settings file byte for byte, and locks cleanly. That GUI profile had no local
  pending settings draft; encrypted pending preservation is proven by the native
  cases, not inferred from this GUI case.
- While the actual GUI held its comparison open, the packaged Windows CLI peer
  renamed the controlled fixture vault on the real server. Keep server refused
  the stale choice and closed it. Reopening review displayed the newer peer vault
  name; a new explicit Keep server adopted it and refreshed navigation. The GUI
  locked, and the peer restored the original vault name. No direct native-command
  mocks or synthetic UI handler substitutions were used for these GUI runs.

`C:/Projects/127Vaults-settings-review-20261015-a/evidence.json` is the combined
verified index. GUI records are `gui.json`, `gui-preservation.json`,
`gui-changed.json`, `gui-changed-adoption.json` and the guarded peer advance/restore
records. Runners `gui-run.mjs` and `gui-changed-run.mjs`, their shell scripts and
`verify-all.mjs` are retained. The exact original server environment and mapping
are restored by each runner; original profiles and prior evidence remain intact.

Next work continues the untouched pairing/lifecycle/deletion/collision and
intended-host/physical gates in the original matrix. Windows GUI remains open,
along with actual web-source extension permission/selection/reconnect and the
other explicitly recorded manual/operational checks. This completed settings
subset is not full release acceptance. No remote push or public deployment.

# Internal release readiness — 2026-10-13

**Decision: not accepted for internal release; expanded sync verification is open.**
The [expanded goal and acceptance matrix](internal-sync-release-plan-2026-10-13.md)
tracks reported live failures and the remaining end-to-end release gates. Passing
scenarios below are subset evidence and do not accept the complete sync workflow.
Earlier installed Windows/Linux queued-conflict review, selected-field resolution and
peer-created vault/collection settings review now pass.
Windows and Linux desktop/CLI, the Chromium extension, web/PWA, self-hosted
server and admin management writes are selected. This report supersedes the
remaining-work list in the [October 12 report](internal-release-readiness-2026-10-12.md),
whose server, admin, migration, recovery and PWA evidence remains applicable.

Five release blockers were reproduced and fixed on local `main`:

| Commit | Fix and validation |
| --- | --- |
| `2706ef8` | Windows uninstall removes only native-host registrations owned by its installation. Same-path updates preserve the manifest and registration. Actual fixture install/update/reconnect/uninstall passes; a different registration survives uninstall. |
| `2cf8a77` | Desktop and native connector share explicit absolute `VAULTS_CONFIG_DIR` selection. Invalid overrides refuse instead of reading another profile. Profile selection tests and actual source handoff pass. |
| `bd85ab0` | Adopted desktop/CLI profiles use separate unlock-agent keyring capabilities. Previously starting one invalidated the other. Canonical path identities separate clones while retaining legacy agent compatibility. Actual simultaneous agents, source handoff and independent lock pass. |
| `27a70eb` | Signup/new-password and ambiguous forms refuse before requesting a saved credential. Regression tests and both installed-browser runs pass. |
| `daf3d78`, `b6dd3e5` | Accepting peer-created settings now refreshes vault names, collection membership and removal preference immediately. Removed selected collections return to all items; unsaved drafts require reviewed discard. A guarded native vault-list command supports the refresh. Both rebuilt desktop packages pass the formerly failing settings-review/navigation case. |

## Acceptance achieved

| Surface | Passed | Still required |
| --- | --- | --- |
| Server and admin | Schema-7 packaged verified HTTPS, audited management writes, PostgreSQL/HTTP/Edge permission checks, recipient ownership acceptance, concurrent last-owner protection, guarded database/identity backup/restore and populated 1→7 migration. See October 12 evidence. | Intended-host human acceptance, unrelated-host deployment and remaining operational policy. No existing installation was migrated. |
| Web/PWA | Real Rust/WASM Edge unlock, offline restart, encrypted queue replay, conflict and lost-response recovery, archive/restore/move and ownership acceptance. Workspace checks/tests pass again. | Intended-host CA/enrollment ceremony, enabled-type cross-client round trips and broader browser/accessibility acceptance. |
| Desktop | Packaged Windows NSIS app: actual UI username/secret/password unlock, online item read, reveal/hide, title edit/save and lock clearing. Packaged Linux AppImage: actual React UI/native backend online cross-client read/edit/save, offline unlock/edit/save, same-profile restart preserving edits and online replay/save with zero pending operations. Both native backends/keyrings and prior two-device tests pass. Windows same-path update/reconnect/uninstall passes. Isolated-root Debian install/reinstall/remove passes using existing-host libraries. | Both platforms also pass queued offline conflict resolution and peer settings review. Fresh Ubuntu container dependencies, GUI startup and package remove/reinstall pass. Still required: clean physical-machine installation/keyring enrollment, broader GUI device/default-view/multiple-vault/removal cases, clipboard/drag exposure and accessibility. Existing Linux package 0.1.0 was preserved. |
| CLI | Latest Windows/Linux packages: real agents/keyrings, concurrent adopted profiles, default list/get pipe redaction and explicit password-only pipe output pass. Prior second-device enrollment, rebase, durable conflicts, offline replay and checkpoints pass. | Physical terminal and clean-machine acceptance, wider settings/device/revocation/rotation cases. |
| Extension | Actual toolbar popup and native host on Windows Edge 155.0.4283.45 and Linux Chrome for Testing 151.0.7922.34: ordinary/split login, explicit same-origin frame selection, cross-origin refusal, shadow DOM, genuine React controlled-form rerender, navigation refusal before native get, no-match, desktop/CLI handoff, browser process restart/reconnect and source lock clearing. No submission occurs. | Physical OS lock/idle expiry, permission/repair matrix, enabled installed-site passkey-provider acceptance and wider external-site/browser/accessibility coverage. |

Browser automation uses synthetic HTTPS documents and strictly fictitious
profiles. It routes website responses locally and never signs in to external
accounts. Toolbar popups, content scripts, activeTab grants, encrypted replicas,
OS keyrings and native messaging are real. Native action instrumentation records
action/source metadata and delegates to the actual host; it does not fabricate
responses. Linux UI uses fixture-only WebKit inspection with real DOM events,
React handlers and the actual native backend. Windows UI used actual UI Automation.
Clean profiles on these existing hosts do not establish clean-machine acceptance.

## Repeatable evidence

### Queued-conflict acceptance

The AppImage UI saved an offline title edit on enrolled device B and reported
pending operations. An independent offline read verified the saved title in the
encrypted replica. Device A made a competing online GUI title edit. After restart
and reconnect, device B showed the conflict dialog, compared both titles while
masking the password, and saved the explicitly selected local title with zero
pending operations. A fresh online read on device A confirmed the resolved title
and encrypted settings reached the server. Lock cleared the decrypted GUI.

The successful packaged GUI evidence is
`/home/vaults-dev/vaults-linux-conflict-20261013-h/conflict-evidence.json`.
The untouched pending fixture remains at
`/home/vaults-dev/vaults-linux-conflict-20261013-c/preserved-pending-profile`.
Shared-engine replay also retained one pending same-field conflict before GUI
resolution. Earlier failed attempts were a harness timing error: selecting a
radio and immediately clicking Save in one script turn saved the previous
selection before React rendered the new choice. The corrected driver waits for
`aria-checked=true` before Save. This was not a confirmed product data-loss bug.

The committed AppImage driver accepts final argument `conflict` and saves
failed diagnostics beside its evidence path. The bounded Rust helper's
`inspect-title`, `conflict` and `settings` modes verify encrypted state and
peer reads without printing passwords. Replay uses a new copy of the pending
fixture and a fresh competing server edit; server state has advanced after the
successful resolution. Windows also passed a queued offline edit, process restart,
competing Linux-device edit, masked comparison and explicit local-title resolution.
Its evidence is `C:\Projects\127Vaults-internal-install-20261013-e\conflict-ui.json`.

### Additional settings acceptance

The AppImage UI created a separately named private vault, verified its empty
item view, created a collection including the selected vaults and returned to
the combined item view. A separately enrolled second device read the encrypted
vault name, collection and saved item through the real server. Evidence is at
`/home/vaults-dev/vaults-linux-ui-20261013-f/settings-evidence.json` and
`C:\Projects\127Vaults-internal-install-20261013-a\linux-settings-second-device.sh`.
This does not close divergent settings/default-view/interruption acceptance.

Windows also passed actual GUI vault/collection creation. Settings changed on one
device deliberately require explicit review on the other. The rebuilt Linux
package accepted Windows-created settings and immediately refreshed both names;
the rebuilt Windows package then accepted Linux-created settings and did the same.
Both verified empty-vault and collection navigation after acceptance. Evidence:
`/home/vaults-dev/vaults-settings-review-20261013-c/settings-review-evidence.json`
and `C:\Projects\127Vaults-internal-install-20261013-e\settings-review-ui.json`.
These runs use desktop `internal-20261013-d`, source `b6dd3e5`.

### Fresh Linux package acceptance and pending passkey consent

The final desktop Debian package and standalone CLI passed in a fresh Ubuntu
24.04 container: declared dependencies installed normally, the actual WebKit GUI
opened its unconfigured trust form, native framing reported no enrolled sources,
and removal/reinstallation preserved a separate profile marker. Evidence is
`C:\Projects\127Vaults-internal-clean-client-20261013-a\evidence.json`;
`scripts/internal-linux-package-smoke.mjs` records artifact revisions and the base
image digest. This supersedes the dependency-lifecycle gap in the table above,
but Xvfb/container startup does not establish physical-machine or keyring enrollment
acceptance.

The installed-site passkey harness is prepared and syntax checked, but registration
and assertion remain unverified. Actual headed Chrome displayed its website-access
permission prompt; the fixture timed out safely without accepting it. Browser
permission approval awaits the user's requested confirmation under the computer-use
consent policy. `scripts/installed-extension-passkey-fixture.mjs` can replay this
gate after approval in a fresh isolated browser profile.

The following scripts are committed for replay with explicit fixture paths:

- `scripts/internal-extension-form-smoke.mjs`, `extension-popup-driver.mjs` and
  `build-extension-react-fixture.mjs`: real popup/form/native-source matrix.
- `scripts/internal-native-connector-smoke.mjs`: source/read/refusal/lock and
  explicit fixture uninstall/update/foreign-registration cases. This API-only
  harness is separate from the popup/form harness.
- `scripts/internal-desktop-ui-smoke.mjs` and `desktop-fixture-inspector.mjs`:
  real packaged Windows WebView2/Linux WebKit UI, configurable previous/new title,
  Online/Offline expectation and conflict/settings review. The earlier Linux entry
  point forwards to this shared harness.
- `scripts/internal-cli-disclosure-smoke.mjs`: captured pipe output assertions,
  with credentials omitted from console diagnostics.
- `apps/cli/examples/internal_connector_fixture.rs`: explicitly enrolled
  `owner_127` fixture agent start/stop/pair, bound to the required installation UUID.

Local evidence remains outside the checkout:

| Evidence | Location |
| --- | --- |
| Windows Edge full popup/form matrix | `C:\Projects\127Vaults-internal-browser-20261013-a\smoke-b\evidence.json` |
| Linux Chrome full popup/form matrix | `/home/vaults-dev/vaults-extension-forms-20261013-g/evidence.json` |
| Windows actual installed UI | `C:\Projects\127Vaults-internal-install-20261013-c\windows-ui-evidence.json` |
| Linux online/offline GUI | `/home/vaults-dev/vaults-linux-ui-20261013-d/evidence.json`, `...-e/evidence.json` |
| Linux same-profile offline process restart | `/home/vaults-dev/vaults-linux-ui-20261013-f/restart-evidence.json` |
| Linux same-profile online replay/save | `/home/vaults-dev/vaults-linux-ui-20261013-f/replay-evidence.json` |
| Windows update/reconnect/owned uninstall | `C:\Projects\127Vaults-internal-lifecycle-20261013-a\evidence.json` |
| Windows foreign registration preservation | `C:\Projects\127Vaults-internal-lifecycle-20261013-c\evidence.json` |
| Windows/Linux packaged CLI pipe disclosure | `...internal-lifecycle-20261013-c\cli-disclosure.json`, `/home/vaults-dev/vaults-extension-forms-20261013-g/cli-disclosure.json` |

Fixture browsers restore the prior active profile pointer and Windows registration
in `finally`. Only the separate 12892 server/project is stopped/restarted; original
12780/12781 installations are preserved. App inspectors are enabled only for the
fixture process. Encrypted fixture profiles and stopped volumes remain for review.

## Artifacts and checks

All six current candidate artifact directories passed complete file-set/SHA-256
verification. [Recorded revisions and checksums](internal-release-artifacts-2026-10-13.json)
are committed; unsigned private-test artifacts remain at `C:\Projects\127Vaults-Releases`.

- Server: `server/internal-20261013-a/linux-amd64`, source `8aeaf9b`, schema 7.
- Desktop: `desktop/internal-20261013-h/{windows,linux}`, source `41e5ba9`.
- CLI: `cli/internal-20261013-e/{windows,linux}`, source `4224086`.
- Extension: `extension/internal-20261013-b/chromium`, source `8aeaf9b`.

Earlier artifacts remain for reproduction but lack the later queued-rebase fixes.
The current packages are prepared candidates; their complete cross-client/UI
acceptance is tracked in the expanded matrix and remains open.

`pnpm check`, `pnpm test`, `cargo fmt --check`, workspace Clippy with warnings
denied and `cargo test --workspace` passed in the earlier run. Latest CLI library:
68 pass, one intentionally
ignored live fixture test; its separate live acceptance evidence is listed above
and in the October 12 report. New harness syntax and Git whitespace checks pass.
Later acceptance-only changes do not alter the selected product binaries.

## Next work

1. Complete remaining settings/default-view, device and enabled item-type cases.
2. Finish physical idle/OS lock and enabled installed passkey-site acceptance.
3. Finish clean physical-machine Windows/Linux installation and Linux keyring
   enrollment; fresh-container Debian dependencies/startup/lifecycle now pass.
4. Complete multi-vault/settings/device and enabled item-type cross-client UI
   cases; retain interruption/revocation and disclosure requirements.
5. Complete the intended-host CA/enrollment and human web/admin walkthrough,
   then review and accept the internal candidate.

Independent review, real-secret approval, signing/public distribution, Cloud and
public beta remain separate. No broad backlog row becomes Done from these subset
checks. Nothing was pushed or published.

## Subsequent development fix: sync failure review

The development desktop now exposes Review sync for failed or queued work. Its
read-only native command decrypts pending requests locally and returns only item
titles, vault/item/operation identifiers, changed field names and existing conflict
markers. Values remain hidden. Confirmed conflicts route to the existing masked
comparison and selected-operation server-copy workflow; unclassified failures
cannot discard local edits. Pending settings have their own review entry.
Overlapping sync requests are guarded, identical notifications are deduplicated,
warning colours replace the misleading green failure indicator, and the timestamp
is labelled Last verified server sync. Lock invalidates late review responses.

Desktop check/18 tests, workspace Clippy and CLI library 62 tests pass (one existing
live-fixture test remains intentionally ignored). A copied fictitious profile
verified durable pending metadata across reopen without field-value disclosure.
Actual isolated desktop UI acceptance is recorded at
`C:\Projects\127Vaults-sync-review-20261013-a\ui-evidence.json`: offline unlock,
item/field review, values withheld, unconfirmed-copy refusal and lock clearing.
The current rebuilt candidates include this follow-up. Their packaged runtime
acceptance is a separate gate from the development UI evidence above.

Conflict comparison now refreshes verified server state without replaying pending
mutations. Errors are displayed within the conflict dialog; server-copy selection
verifies the current server state before retiring the selected operation. Two
HTTP regression tests verify read-only comparison and unchanged pending ciphertext
on a failed refresh. Isolated offline UI evidence at
`C:\Projects\127Vaults-sync-compare-20261013-a\ui-evidence.json` verifies inline
comparison/server-copy errors and retained queued work. This fixture uses an
explicit test conflict marker; it does not establish the cause of the user's 409.

Further connection diagnostics found an October 9 registered native host reporting
the desktop agent inactive while the rebuilt host reported that same agent active.
The local registration was updated to a persistent rebuilt connector, preserving
the existing extension ID; its original manifest is backed up with the development
recovery evidence. Web-source selection now includes an active unlocked vault tab,
tries other matching tabs when one is locked/inaccessible, and maintains exact
origin/port checks. Three selection regressions pass (26 extension tests total).
Conflict dialogs now retain their owning vault for comparison, selected-field save
and server-copy actions rather than relying on the changing main view. Desktop and
web checks pass. The user's live Edge popup and specific remaining conflict require
confirmation after extension reload and app unlock; no user edit was discarded.

## October 14 expanded verification

Selected server/web `internal-20261014-d` and Windows/Linux Desktop/CLI
`internal-20261014-a` include fixes for real PWA conflict-code mismatch, stale
native creation predecessors and hidden web card fields. The
[expanded evidence matrix](internal-sync-release-plan-2026-10-13.md) records trusted
browser enrollment, online/offline web/native round trips, field merge/server-copy
recovery, seven enabled types with related/custom secrets and new Linux GUI
consecutive saves. Latest checksums/provenance are in the
[artifact inventory](internal-release-artifacts-2026-10-13.json). Full release
acceptance is still open, especially Windows GUI and actual web-source extension,
broader lifecycle/authorization, cache-update and physical-host gates.

Further October 14 work closes CLI read-only comparison and selected-field merge
capability gaps. Selected Windows/Linux CLI `internal-20261014-b` packages pass
both directions against the real TLS/PostgreSQL fixture; explicit whole-version
choices, automatic non-overlapping merge and archive/restore subsets also pass.
See the [sync parity tracker](sync-parity-2026-10-14.md). CLI custom fields are
selected as one array; finer custom-field choices remain a difference. Item-queue
success is recorded separately from pending/conflicting vault settings. These
results do not close the remaining GUI, extension-web and full release gates.

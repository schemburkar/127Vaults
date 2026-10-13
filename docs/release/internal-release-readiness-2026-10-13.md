# Internal release readiness — 2026-10-13

**Decision: internal fictitious-data release candidate; final acceptance remains open.**
An installed Linux queued-conflict discrepancy discovered near the cutoff is
an open P1 acceptance gate. See the reproduction below before accepting this candidate.
Windows and Linux desktop/CLI, the Chromium extension, web/PWA, self-hosted
server and admin management writes are selected. This report supersedes the
remaining-work list in the [October 12 report](internal-release-readiness-2026-10-12.md),
whose server, admin, migration, recovery and PWA evidence remains applicable.

Four release blockers were reproduced and fixed on local `main`:

| Commit | Fix and validation |
| --- | --- |
| `2706ef8` | Windows uninstall removes only native-host registrations owned by its installation. Same-path updates preserve the manifest and registration. Actual fixture install/update/reconnect/uninstall passes; a different registration survives uninstall. |
| `2cf8a77` | Desktop and native connector share explicit absolute `VAULTS_CONFIG_DIR` selection. Invalid overrides refuse instead of reading another profile. Profile selection tests and actual source handoff pass. |
| `bd85ab0` | Adopted desktop/CLI profiles use separate unlock-agent keyring capabilities. Previously starting one invalidated the other. Canonical path identities separate clones while retaining legacy agent compatibility. Actual simultaneous agents, source handoff and independent lock pass. |
| `27a70eb` | Signup/new-password and ambiguous forms refuse before requesting a saved credential. Regression tests and both installed-browser runs pass. |

## Acceptance achieved

| Surface | Passed | Still required |
| --- | --- | --- |
| Server and admin | Schema-7 packaged verified HTTPS, audited management writes, PostgreSQL/HTTP/Edge permission checks, recipient ownership acceptance, concurrent last-owner protection, guarded database/identity backup/restore and populated 1→7 migration. See October 12 evidence. | Intended-host human acceptance, unrelated-host deployment and remaining operational policy. No existing installation was migrated. |
| Web/PWA | Real Rust/WASM Edge unlock, offline restart, encrypted queue replay, conflict and lost-response recovery, archive/restore/move and ownership acceptance. Workspace checks/tests pass again. | Intended-host CA/enrollment ceremony, enabled-type cross-client round trips and broader browser/accessibility acceptance. |
| Desktop | Packaged Windows NSIS app: actual UI username/secret/password unlock, online item read, reveal/hide, title edit/save and lock clearing. Packaged Linux AppImage: actual React UI/native backend online cross-client read/edit/save, offline unlock/edit/save, same-profile restart preserving edits and online replay/save with zero pending operations. Both native backends/keyrings and prior two-device tests pass. Windows same-path update/reconnect/uninstall passes. Isolated-root Debian install/reinstall/remove passes using existing-host libraries. | Clean-machine installation, normal Linux package lifecycle with dependencies, broader GUI device/settings/multiple-vault/removal cases, clipboard/drag exposure and accessibility. The separate dpkg database used forced dependency handling; it does not accept a fresh-host install. Existing Linux package 0.1.0 was preserved. |
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

### Open P1: packaged Linux queued-conflict review

The actual AppImage UI saved a second device's offline title edit and reported
pending operations. A separate Rust offline read verified that title in the
encrypted replica. After an explicit competing online GUI edit on device A,
the packaged device-B UI showed the remote title and zero pending operations,
without the expected conflict review dialog. Repeated GUI attempts did not pass.
An additional run verified the displayed device identity against the explicit
fixture profile. This must be investigated; successful basic save/replay checks
do not close this gate, and these observations do not yet establish the root cause.

The untouched pending profile is preserved at
`/home/vaults-dev/vaults-linux-conflict-20261013-c/preserved-pending-profile`.
Replaying a copy through the current shared Rust engine produced **pending=1,
conflicts=1, rebased=0**. The engine retained the same-title edit for explicit
review. The GUI/packaged-runtime discrepancy remains unresolved; do not claim
the queued GUI conflict walkthrough passed or that a data-loss cause is proven.

Reproduction artifacts are outside the checkout under
`C:\Projects\127Vaults-internal-install-20261013-a\linux-conflict-*.sh` and
`linux-conflict-*.log`; fixture roots are
`/home/vaults-dev/vaults-linux-conflict-20261013-{a,b,c,d}` and
`/home/vaults-dev/vaults-conflict-core-20261013-a`.
The committed AppImage driver accepts final argument `conflict` and saves failed
UI diagnostics alongside the requested evidence file. The strictly bounded
Rust helper's `inspect-title` and `conflict` modes verify preserved encrypted
state and shared-engine review without printing passwords. Retain the untouched
pending profile when replaying; use another copy for mutations.

### Additional settings acceptance

The AppImage UI created a separately named private vault, verified its empty
item view, created a collection including the selected vaults and returned to
the combined item view. A separately enrolled second device read the encrypted
vault name, collection and saved item through the real server. Evidence is at
`/home/vaults-dev/vaults-linux-ui-20261013-f/settings-evidence.json` and
`C:\Projects\127Vaults-internal-install-20261013-a\linux-settings-second-device.sh`.
This does not close divergent settings/default-view/interruption acceptance.

The following scripts are committed for replay with explicit fixture paths:

- `scripts/internal-extension-form-smoke.mjs`, `extension-popup-driver.mjs` and
  `build-extension-react-fixture.mjs`: real popup/form/native-source matrix.
- `scripts/internal-native-connector-smoke.mjs`: source/read/refusal/lock and
  explicit fixture uninstall/update/foreign-registration cases. This API-only
  harness is separate from the popup/form harness.
- `scripts/internal-linux-desktop-ui-smoke.mjs`: real packaged AppImage UI,
  configurable previous/new title and Online/Offline expectation.
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

All six selected artifact directories passed complete file-set/SHA-256
verification. [Recorded revisions and checksums](internal-release-artifacts-2026-10-13.json)
are committed; unsigned private-test artifacts remain at `C:\Projects\127Vaults-Releases`.

- Server: `server/internal-20261012-c/linux-amd64`, source `61cfcea`, schema 7.
- Desktop: `desktop/internal-20261013-b/{windows,linux}`, source `27a70eb`.
- CLI: `cli/internal-20261013-b/{windows,linux}`, source `bd85ab0`.
- Extension: `extension/internal-20261013-a/chromium`, source `27a70eb`.

`pnpm check`, `pnpm test`, `cargo fmt --check`, workspace Clippy with warnings
denied and `cargo test --workspace` pass. CLI library: 62 pass, one intentionally
ignored live fixture test; its separate live acceptance evidence is listed above
and in the October 12 report. New harness syntax and Git whitespace checks pass.
Later acceptance-only changes do not alter the selected product binaries.

## Next work

1. Resolve and rerun the packaged Linux queued-conflict discrepancy above.
2. Finish physical idle/OS lock and enabled installed passkey-site acceptance.
3. Finish clean-machine Windows/Linux installation and Linux package lifecycle.
4. Complete multi-vault/settings/device and enabled item-type cross-client UI
   cases; retain interruption/revocation and disclosure requirements.
5. Complete the intended-host CA/enrollment and human web/admin walkthrough,
   then review and accept the internal candidate.

Independent review, real-secret approval, signing/public distribution, Cloud and
public beta remain separate. No broad backlog row becomes Done from these subset
checks. Nothing was pushed or published.

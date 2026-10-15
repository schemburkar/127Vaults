# Internal release readiness — 2026-10-12

Historical report. See the [October 13 update](internal-release-readiness-2026-10-13.md) for current artifact selection, passed GUI/extension checks and remaining gates.

The requested scope is the self-hosted server, web/PWA, Windows and Linux
desktop and CLI, Chromium extension, and admin management writes. Acceptance
uses fictitious data only. Cloud, public distribution and real-secret approval
remain separate gates. Both Windows and Linux are required.

**Decision: internal release candidate; final acceptance remains open.** The
server, admin write slice and native client backends pass the checks below.
The complete installed-extension form/site/source matrix, clean-machine
installation and the final human walkthrough have not passed. Do not describe
all app surfaces as internally accepted yet.

| Surface | Passed evidence | Remaining acceptance |
| --- | --- | --- |
| Server | Extracted schema-7 bundle, verified HTTPS, hostile encrypted-item paths, database/identity encrypted backup, empty-project guarded restore, overwrite refusal and existing-owner read after restore; populated schema 1→7 migration with dry runs and lock contention | Unrelated host, Docker/private LAN and operational policy remain supported-release gates |
| Admin | Production PostgreSQL and HTTP permission/password/Origin/CSRF tests; Edge management walkthrough; invitation writes, suspension, role changes, device revocation, accepted ownership and concurrent last-owner protection | Human acceptance; separate local operator roles must be configured explicitly; SMTP resend and secret settings stay in operator runbooks |
| Web/PWA | Real Rust/WASM unlock fixture, offline restart, queued edit, conflict resolution, lost-response replay, archive/restore/move and recipient ownership acceptance; source checks/tests pass | Intended-host CA ceremony, wider browser/accessibility matrix and enabled type cross-client round trips |
| CLI, Windows and Linux | Fresh profiles against the restored schema-7 server; OS keyrings; real second-device enrollment; different-field rebase, durable same-field conflict, offline replay, ciphertext-only replica and signed checkpoint; packaged startup/native framing | Clean-machine terminal/disclosure acceptance and wider settings/device/revocation matrix |
| Desktop, Windows and Linux | Native Windows executable and Linux AppImage launch; actual Tauri native commands pass online/offline unlock, OS-keyring connector startup, decrypted read and lock refusal. Windows and Linux process restart tested. Frontend workspace smoke passes separately | End-to-end GUI workflow on both installed packages, clean-machine install/update/uninstall  |
| Extension | Packaged MV3 loaded in isolated Edge; actual native messaging to packaged host; server stopped and web absent; offline source/list/get, wrong-origin refusal, generic-write refusal and lock clearing. Edge passkey adapter smoke passes separately | Visible installed popup/form-fill, Chrome matrix, desktop/CLI source handoff, frames, idle/OS lock, restart and permission/repair/uninstall matrix |

## Artifacts and provenance

All artifacts are unsigned private-test builds, outside the checkout at
`C:\Projects\127Vaults-Releases`. Each directory includes `release.json`,
`SHA256SUMS` and the verifier. No push or publication occurred.
All six selected directories passed full file-set and SHA-256 verification;
the [recorded revisions and checksums](internal-release-artifacts-2026-10-12.json)
preserve that evidence in this repository.

- Server: `server/internal-20261012-c/linux-amd64`, source `61cfcea`, schema 7,
  image `localhost/127vaults-server:release-4c92423254fc7009`.
- Desktop and CLI: `desktop/internal-20261012-a/{windows,linux}` and
  `cli/internal-20261012-a/{windows,linux}`, source `c10f68a`.
- Extension: `extension/internal-20261012-a/chromium`, source `f465963`.

These differing revisions are explicit. Desktop/CLI/extension product sources
were unchanged by the admin schema-7 commit. The browser and admin distribution
are included in the schema-7 server build. Verification examples and acceptance
documentation added afterward do not change those product binaries.

## Repeatable checks and fixture boundary

`tests/internal/server/server-release-smoke.mjs` accepts an extracted release tar,
new external workspace, Compose provider and free loopback port. It refuses an
existing workspace/listener, creates separate projects and stops only its own
projects. The explicit fixture port override recomputes the inner manifest;
this is evidence on the existing host, not a clean-host claim.

`scripts/ops/migration-rehearsal.mjs` passed against the exact schema-7 image
with `VAULTS_MIGRATION_IMAGE` set. `scripts/admin-directory-smoke.mjs
--management --browser` verifies real PostgreSQL actions and the Edge console.
The final packaged write/recovery evidence is retained at
`C:\Projects\127Vaults-internal-recovery-20261012-f\evidence.json`.
See [admin evidence](internal-admin-management-evidence-2026-10-12.md).

`apps/cli/examples/api010_acceptance.rs` accepts a **new**
`VAULTS_INTERNAL_CLIENT_ROOT`, fixture URL, public CA path and installation UUID
through `VAULTS_INTERNAL_CLIENT_URL`, `VAULTS_INTERNAL_CLIENT_CA` and
`VAULTS_INTERNAL_SERVER_ID`. It preserves historical defaults when unset.
Authentication rate limits remain enforced; the harness waits once for a new
window on 429. Linux ran under a new D-Bus session and a fixture-only
`XDG_DATA_HOME` with GNOME Keyring, without replacing the user's home directory.

`internal_connector_fixture.rs` starts/stops only an explicitly supplied,
enrolled fictitious `owner_127` profile matching the required fixture UUID.
The native-host browser test temporarily selected that profile and registered
the fixture extension ID, then restored the prior pointer and registry value.
The repeatable Windows Edge API check is
`tests/internal/extension/native-connector-smoke.mjs`; all five explicit arguments are
required, and the new external workspace retains evidence and prior registration
metadata. The server-stopped run passed at
`C:\Projects\127Vaults-internal-native-20261012-b\evidence.json`.
A locked-agent negative run failed as expected and preserved the original
profile pointer bytes and registration value; its fixture is retained with
suffix `-c`.
It does not automate or accept the popup/form-fill walkthrough.
No existing installation was migrated. Original listeners on 12780/12781 and
their database were preserved; fixture identities and stopped volumes remain
outside the checkout for review.

Native desktop acceptance used an isolated `VAULTS_CONFIG_DIR` and the app's
local native-command test interfaces, not a mocked `invoke`. Windows used a
loopback WebView2 inspector; Linux used the packaged AppImage and the
[WebKitGTK inspector HTTP interface](https://trac.webkit.org/wiki/EnvironmentVariables).
Those inspectors were enabled only for the fixture process and were closed
after testing. They do not constitute a GUI walkthrough or clean installer test.

## Next P1 closure order

1. Complete installed extension selected-login fill and the Chrome/Edge native
   source, restart, origin, frame and lock matrix.
2. Run installed desktop GUI and clean-profile installer/update/uninstall
   acceptance on Windows and Linux, using the artifacts above.
3. Complete intended-host CA/enrollment and human web/admin walkthrough; record
   accepted enabled types and settings/device behavior.
4. Review this evidence and approve the internal candidate. Independent crypto
   review, signing/legal, real-secret pilot, Cloud and public beta stay separate.

# Sunrise upgrade-first follow-up

User authorized fixing release blockers, preparing the selected backlog, publishing new experimental installers on the public invitation flow, and upgrading the existing Sunrise installation before a separate fresh setup.

Prepared changes: native Compose preflight and `up --no-build` capability check; private IPv4 validation; Windows SID ACLs; TLS directory/key ownership and explicit CA file fingerprint; TLS pass-through ingress relay; stale open-item refresh; prompt UI lock and bounded local-agent IPC; schema-8 encrypted backup/rehearsal and license/clock identity backup; guarded upgrade command; operator-offered updated download links that retain trial binding/expiry; public setup checklist; native Tailscale/peer discovery; macOS Keychain/registration/packaging preparation and a future manual compile workflow.

Local evidence so far: full JavaScript suite, Rust workspace tests, strict Clippy, web/desktop type/build checks; focused upgrade failure/preservation tests; a real isolated Podman relay round trip; fresh Windows TLS generation with UID-1000 key readability; Edge checklist navigation/resume/finish and 390px layout with no horizontal overflow. Mac workflow has not run.

Required next steps:

1. Finish release-source review/checks; commit to local main. Preserve unrelated `deploy/cloudflare.json` and extension icon work.
2. Build new Windows desktop/CLI/extension and server from the committed snapshot, using the existing trusted issuer public keys. Publish only verified immutable artifacts; preserve existing trial activation and expiry.
3. Upgrade Sunrise using a new extracted bundle, encrypted backup/restore rehearsal and its existing project, private identity, database and license. Retire the temporary SSH ingress forwarding without disrupting Podman's API connection. Verify the real native relay path rather than masking it with that forward.
4. Install the Windows desktop update at its existing path; preserve profile/device enrollment/offline data. Update CLI and native connector at stable paths, reload the extension, and verify existing vault/item, cross-client refresh, offline queued edit/reconnect, lock and fill.
5. Perform a distinct published-package Tailscale setup and two-computer trust/enrollment/sync test after the existing-installation upgrade is accepted. Do not silently change Sunrise's existing origin during the binary upgrade.
6. Keep Cloudflare private routing exploratory and Mac distribution gated on native builds, signing/notarization and clean-Mac acceptance. No GitHub repository exists; no code push or remote workflow has been run.

## Saved checkpoint — user requested slowdown, 2026-10-17

Stop starting new work until the user resumes. Publication and the Sunrise upgrade are on hold. No new deployment or installation change has been made on Sunrise in this fix pass.

Implementation and relevant checks are complete in local main commit `50b4c4f8aec16e8558af620705d58b72eb55e913` (`fix: prepare guarded private-server upgrades and consumer setup`). It includes the preserved extension branding commit `2532ac2`. Untracked `deploy/cloudflare.json` is unrelated and must remain untouched. Do not push.

### Builds already running

Both builds use fixed source `50b4c4f` and label `sunrise-upgrade-20261017-50b4c4f`; do not rebuild from this later documentation checkpoint.

- Windows server build: execution session `47910`, process ID `31040`. Last observed building the server image after passing checks. Global lock: `C:\Users\shubh\.127vaults-release-cache\.build-lock`. Attempt: `C:\Users\shubh\.127vaults-release-cache\attempts\b7e486289f9f-85ae14fc-80a1-4048-8a16-de20d0248170`.
- Linux desktop build: execution session `6977`, WSL `Ubuntu-24.04`, user `vaults-dev`. Last observed compiling release CLI sidecars after checks. Attempt: `/home/vaults-dev/.127vaults-release-cache/attempts/f7d64ab44df7-6beb328e-6b86-4f52-97cd-48a5eef864bf`.
- Completion is not yet confirmed. Inspect sessions/processes and attempt results before restarting anything. Never remove a live build lock. Windows builds share one global lock and must run serially; the separate Linux cache can run independently.

Request files outside Git are under `C:\Users\shubh\.127vaults-release-cache`: `sunrise-server-request.json`, `sunrise-desktop-request.json`, `sunrise-cli-request.json`, `sunrise-extension-request.json`, and `sunrise-desktop-linux-request.json`. Public issuer keys are in `trial-issuer-public-keys.json` there. Resume with `node scripts/release/release.mjs --config <request-file>`. Queue Windows desktop, CLI and extension after the server; prepare Linux CLI after Linux desktop. Preserve the currently offered Linux downloads by building their replacements too.

Outputs belong under `C:\Projects\127Vaults-Releases\<product>\sunrise-upgrade-20261017-50b4c4f\<platform>`. Versions: server/desktop/CLI `0.0.1`, extension `0.1.1`. Verify completed manifests and hashes before publication; immutable output labels must not be overwritten blindly.

### Publication has not happened

Ignored `.cloudflare-deploy/config-upgrade-20261017.json` is prepared with the new release ID and references `./catalogue-upgrade-20261017.json`; that catalogue has NOT been created. Existing config/catalogue remain unchanged. Wrangler authentication was checked successfully. After all builds pass, prepare the verified private catalogue with the existing pinned issuer keys, deploy through the existing tooling, and explicitly offer updated packages to the existing activated request using `update-release`. Preserve license bytes, installation binding and original expiry. Do not repeat trial activation or initialize a replacement server.

### Sunrise preservation and resume hazards

Sunrise is `100.99.146.58`, SSH account `shubh`, local key `C:\Users\shubh\.ssh\127vaults_sunrise`. Existing bundle: `C:\Users\shubh\Downloads\127Vaults-Trial\server\127vaults-server-0.0.0-linux-amd64`; private identity: `C:\Users\shubh\.127vaults-test`; Compose project: `vaults-test-4e7821b9fb36`. Installation UUID: `28c1ea8c-255f-4e1a-a1de-80809254f0e1`, schema 8. Preserve the active trial and its expiry `2026-10-27T12:33:30.577Z`.

The temporary scheduled task `127Vaults-Loopback-Forward` forwards BOTH app port 12780 and Podman VM SSH/API port 58346. Simply stopping it also breaks Podman access. Make encrypted database and identity backups and restore rehearsal first, then restore normal VM forwarding or split the VM SSH forward before retiring only app ingress. Verify the new native relay with no old app forward masking it. Do not reset the VM, database, identity or enrollment.

Consumer credentials are protected outside Git at `C:\Users\shubh\.codex\sunrise-smoke\credentials.json`; never print or commit their contents. Existing CLI profile on Sunrise: `C:\Users\shubh\.127vaults-consumer-cli`. Desktop profile: `C:\Users\shubh\AppData\Roaming\127Vaults`; installed executable: `C:\Users\shubh\AppData\Local\127Vaults Desktop\vaults-desktop-poc.exe`. Edge extension ID: `aljmkcbbeondcmmjjmnhmacpfnppiloe`. Keep testing in the same consumer Edge profile, not the unrelated KDP profile.

Previously passed basic consumer checks: vault/item creation, desktop read/edit, CLI login/read/sync, actual extension fill without submission, offline desktop edit and reconnect sync. New installers and their upgrade preservation are NOT yet accepted on Sunrise. After upgrade, retest those basics plus open-item refresh, locking, native connector and existing device/profile retention; only then run a distinct Tailscale setup/two-machine test.

Mac work remains preparation only: no Mac, Apple Developer account or GitHub repository. Signing/notarization and actual Mac/Chrome acceptance remain gated. Cloudflare private WARP routing remains exploratory; no public tunnel hostname has been enabled. The email-notification request remains a separate aside and must not displace Sunrise acceptance.

## Resumed — operator session follow-up

Weekly usage checked at resume: 80% used, 20% remaining. Both fixed-source server and Linux desktop builds produced release manifests; checksum verification remains pending. Added one-hour, signed, Secure/HttpOnly/SameSite=Strict operator cookies scoped to the admin API. Fresh operator key exchange is required to renew; API actions retain origin checks, and sign-out clears the cookie. No operator key is stored in browser storage. Focused intake/session tests: 17 passed, including expiry/tampering/key rotation, Worker key exchange, cookie-authenticated refresh, cross-origin rejection, renewal rejection and logout.

Additional user request: use the public site's current logo AND wordmark across all apps. This changes affected release sources, so the completed 50b4c4f artifacts are diagnostic predecessors, not the final branded release. Finish branding and build a coherent new snapshot before publishing. No new public deployment or Sunrise upgrade yet.

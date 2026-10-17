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

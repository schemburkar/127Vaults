# Self-hosted client handoff acceptance

Status: automated handler checks and client builds passed on 2026-10-07; a live two-device customer rehearsal has not yet been recorded. Use a disposable signed test license and sample vault data.

## One installation, two devices

1. Start a fresh private server and install its test license. Record the installation ID, HTTPS endpoint and public CA SHA-256 fingerprint from the operator channel.
2. On a second Windows computer or isolated profile, open desktop registration. Enter the private endpoint, installation ID, copied public CA certificate path and independently checked fingerprint. A wrong fingerprint, wrong endpoint or untrusted certificate must leave the desktop unconfigured.
3. Create the owner through the server web app using the host-local bootstrap code. Enroll the desktop as a new device; approve the code in the already trusted web session. Confirm a second device appears in Trusted devices and its first online unlock hydrates a local encrypted replica.
4. Enroll a separate CLI profile through `127vaults server trust` and `127vaults login USERNAME --enroll`. Approve its code in the web session. Confirm desktop and CLI both read a sample item, then edit it on one and sync the other. Exercise an offline edit, reconnect and explicit conflict review.
5. Revoke one device from the web app. Verify that it cannot establish a new online session while the other device still can. Record any offline replica behavior separately; offline revocation cannot be instantaneous.
6. Set a signed test license into read-only, locked and revoked states, then renew with a higher-sequence license. Verify web, desktop, CLI and extension notices; server writes must fail while reads and appropriate recovery paths remain available. Confirm queued encrypted edits are retained through renewal.

## Current evidence and blockers

- `node --test apps/server/test/device-enrollment-handler.test.mjs apps/server/test/device-lifecycle-handler.test.mjs apps/server/test/device-lifecycle-pg.test.mjs`: seven passing handler/store tests on 2026-10-07.
- `cargo test -p vaults-cli --lib`: 36 passing tests. Web and desktop check/build commands passed on 2026-10-07.
- `pnpm dev:status` found no running local server, so this turn did not exercise the live browser, desktop and CLI sequence. No cross-device acceptance claim is made.
- Chrome/Edge extension packaging, native host installation, second-host private-network trust, live SMTP invitation, signed public clients, and independent security review remain separate release gates.

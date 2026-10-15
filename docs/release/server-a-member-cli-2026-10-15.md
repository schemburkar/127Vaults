# Selected admin UI and new packaged member CLI — October 15

Selected server/web/admin-a (`cbb1be0`, image4bfc4bf6) now passes its actual admin
browser walkthrough and a new member CLI enrollment/read flow. Full internal
release remains unaccepted; these are specific additional combinations.

The selected admin assets/API pass ownership request/cancel, refreshed empty
pending list, password clearing, friendly last-owner refusal and same-request-ID
retry, audit display, narrow-layout overflow and separate admin-operator
restrictions. The account and ownership state are preserved: request cancelled,
last-owner suspension refused and no vault mutation performed by this phase.

A fresh Windows CLI profile then used the selected CLI-a (`600f206`) to establish
pinned HTTPS trust and generate its own random device signing key. Its requesting
UUID and public-key fingerprint were captured from the actual enrollment command.
The already genuinely enrolled member browser unlocked using production OPAQUE,
opened Settings → Devices → Register a device and approved its eight-character
code. Before the actual inspection response was delivered to the browser app, the
test verified its member account ID, full requested UUID and public-key fingerprint.
The response was not replaced. The app's real key signed approval; the CLI polled,
verified approval, completed possession proof and stored its new key through the
normal OS-keyring path. No private key, device.conf or session was seeded.

The same packaged executable performed real member-agent login and sync. It read
the web-created valid move's exact title/website/username, default password redaction
and explicit password, the preserved historical destination-edit title, six-item
destination catalogue, source retirement and empty review. This is a genuinely new
native device independently reading member data; earlier owner reader evidence
remains separate. The browser cleared its enrollment code and locked; the agent
was locked/stopped after reads. The new device/profile/key are deliberately retained
for later acceptance, rather than revoked or reset.

The binary hash equals the selected Windows CLI hash already verified against its
release archive, and the release manifest/source revision is checked again. The
runner asserts the exact selected server image before enrollment. Original fixture
profiles remain untouched; fresh profile:
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a/member-cli-windows-a`.
The enrollment helper refuses re-enrollment when device.conf exists. Use this as
an existing enrolled profile for future work, not as a disposable reset target.

Evidence in the selected candidate work directory:
`ownership-admin-browser.json`, `member-cli-web-approval.json`,
`member-cli-windows.json`, `member-acceptance-combined-evidence.json`.
The transient code/request file remains private local fixture evidence and is not
copied into the combined record. Retained admin runner: `run-admin-browser.mjs`.
The packaged enrollment runner is the repository helper below; rerunning it now
intentionally refuses the already enrolled profile.

```powershell
node scripts/internal-member-acceptance-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a
```

New helper syntax and combined verification pass. The chain revalidates native
reader/P1/move records and exact bundle/wiring, stopped owned project, original
12892 health and revoked D's retained request/journal. Approval container is gone.
No product runtime/artifact or selected candidate changed; no push. Automated
binding comparison is not a claim about a human fingerprint-review UX or physical
browser/clean-host installation. Linux member enrollment, additional native/member
writers, wider interruption/pairing and physical/Windows/PWA/extension/intended-host
gates remain open. No Windows GUI policy setting or native-host registration was
changed in this run.

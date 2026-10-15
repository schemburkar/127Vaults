# Selected Linux member CLI enrollment — October 15

The selected Linux CLI-a (`600f206`) genuinely enrolled a fresh member device
against selected server/web/admin-a (`cbb1be0`, image `4bfc4bf6`). This closes the
Linux member enrollment/read gap left by the Windows member checkpoint. Full
internal release remains unaccepted.

The actual packaged executable established pinned HTTPS trust, generated its own
random signing key and displayed an enrollment code, device UUID and fingerprint.
The retained member browser performed real OPAQUE unlock and Settings → Devices
approval. The strict-CA transport verified the actual inspection response's account,
full device UUID and public-key fingerprint before delivering it unchanged to the
app. The app signed approval; the CLI verified it, completed possession proof and
stored its key through Linux Secret Service. No key, config or session was seeded.
The new device is distinct from the original member, browser and Windows CLI.

The packaged agent synced and independently read the valid web move's exact
ordinary fields, masked/default and explicit password, preserved destination-edit
title, six-item destination catalogue, retired source and empty conflict review.
It then locked and stopped. A fresh agent process unlocked the persisted key,
performed an online device request/sync and read the same password again.
The extracted binary hash matches the previously archive-verified selected Linux
CLI; the selected manifest/source is verified again. The Windows orchestrator
asserted the exact running server image before starting Linux enrollment.

The Linux profile is retained at
`/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/member-cli-linux-a`.
Do not reset or re-enroll it. The enrollment worker refuses existing device.conf;
the orchestrator refuses an existing enrollment-request record. This is WSL with
the existing isolated test keyring, inside a private D-Bus session, not physical
clean-host installation or human fingerprint-comparison acceptance.

The first helper attempt stopped before enrollment because it used a Windows CA
path under Linux. That helper path was corrected; no product fix was needed.
The completed attempt passed. Failed diagnostics are retained privately.

Evidence is under
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a`:
`member-cli-linux.json`, `member-cli-linux-web-approval.json` and
`member-linux-combined-evidence.json`. Enrollment codes remain private fixture
records and are excluded from combined evidence. Browser code cleared and app
locked. Member agent processes and approval container are absent; owned project
is stopped. Existing selected-native/P1 verification confirms exact bundle/wiring,
original 12892 health and the unchanged revoked-D journal/encrypted pending copy.

Recheck evidence/cleanup without re-enrollment:

```powershell
node tests/internal/audit/member-acceptance-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a --linux
```

New/changed helper syntax and combined checks pass. No product artifact changed,
no Windows GUI policy/registration setting changed, and nothing was pushed.
Broader new-server writers/interruption/pairings, current Windows GUI, physical
installation/keyring/OS-lock, PWA/extension and intended-host gates remain open.

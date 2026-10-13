# Desktop in progress — internal release acceptance

Updated 2026-10-13. Owner: desktop implementation. Current work: DESK-004–008 internal release acceptance on Windows and Linux. Real packaged Windows/Linux GUI unlock, item read, reveal/hide, edit/save and lock clearing pass. Linux offline GUI edits survive same-profile process restart; native online/offline backend/keyring checks also pass. Windows same-path update/reconnect and owned/foreign-registration uninstall pass. Next finish clean-machine/Linux package lifecycle and wider device/settings/disclosure acceptance. DESK-008/009 broader two-device settings and interrupted move workflows remain partial.

Record acceptance in the component backlog. See [current evidence and remaining gates](../release/internal-release-readiness-2026-10-13.md). No broad row is Done from these subset checks.

Next P1: the installed Linux queued-conflict walkthrough failed to show review,
while the preserved profile retains one pending conflict in the shared Rust
engine. Investigate the packaged-runtime/GUI discrepancy and replay from a copy
of the preserved pending fixture. Basic GUI vault/collection creation and a real
second-device encrypted settings read passed; wider conflict acceptance remains open.

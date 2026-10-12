# Backlog priority review

Updated 2026-10-12. The user selected an internal fictitious-data release across server, web/PWA, extension, admin, desktop and CLI. **Windows and Linux are required; admin management writes are required.** This replaces the older conditional client scope and read-only-admin priority. The component [backlogs](README.md) retain their wider acceptance conditions.

See the [internal release candidate evidence and remaining gates](../release/internal-release-readiness-2026-10-12.md). The goal is not yet achieved across every surface: installed-extension fill, installed desktop GUI/clean-machine acceptance and human CA/browser acceptance remain open. Public beta and real-secret use have separate [release gates](../release/beta-readiness.md).

| Priority | Current meaning |
| --- | --- |
| P0 | Security/data-loss regression or a required runtime boundary for an explicitly selected mode |
| P1 internal | Blocks acceptance of a selected internal surface on Windows or Linux |
| P1 supported release | Installation, deployment and review required before a supported release |
| P2 | Optional expansion outside the internal acceptance cut |

## Selected P1 closure order

| Order | Component and rows | Evidence and next action |
| --- | --- | --- |
| 1 | Extension EXT-002–005, EXT-007–009, EXT-012 | Packaged Edge/native-host offline discovery/read/origin/write/lock and Edge passkey adapter pass. Finish visible selected-login fill, Chrome/Edge source handoff, frames/navigation, idle/OS lock, restart and installer registration matrix. Unlock belongs to the source client. |
| 2 | Desktop DESK-004–008 | Windows/Linux packages and native online/offline backend/keyring checks pass; Windows and Linux process restart passes. Finish installed GUI, clean-machine install/update/uninstall, device/settings and disclosure acceptance. Shared-engine two-device tests close only part of DESK-004. |
| 3 | CLI CLI-003/004/006/008/009 | Both platform packages, live keyrings, second-device enrollment, durable conflicts, offline replay and checkpoints pass. Finish terminal/pipe disclosure, clean-machine and remaining device/settings cases. |
| 4 | Web WEB-003/005–008 | Enrollment and installed-PWA offline recovery are implemented. Edge Rust/WASM fixture passes restart/conflict/replay and ownership acceptance. Finish intended-host CA/human ceremony, enabled type cross-client round trips and wider browser/accessibility matrix. Ordinary browser sessions remain online-only. |
| 5 | Admin SRV-016 | Schema-7 audited invitation/account/device/role/ownership writes pass PostgreSQL, HTTP, Edge and packaged HTTPS. Finish human acceptance. SMTP resend, secret settings and restore remain operator workflows. |
| 6 | Server SRV-002/003/005/013 | Extracted schema-7 guarded backup/restore and populated 1→7 migration pass. Unrelated-host/Docker/private-LAN, operational shutdown/upgrade and backup-key custody remain supported-release gates. |

Admin management writes have been implemented during this window. The contract includes confirmations, fresh operator passwords, exact Origin/CSRF, redacted audit, exact replay receipts and concurrent last-owner protection. Local console operators remain distinct from enrolled account roles. Ownership requires the recipient's own freshly authenticated acceptance.

## Scope boundaries

- Shared vaults and native iOS/Android/iPad delivery remain excluded. Work is a second private vault.
- Cloud rows remain P0 **for Cloud**, but Cloud startup remains closed and is outside this self-hosted candidate.
- Public site commercialization, optional table output, drag-to-fill and wider import/export do not block this internal cut.
- Enabled license behavior must preserve reads and encrypted pending work. Production entitlement/clock/restore policy remains in SRV-017/018 and the supported-release gate.
- Independent cryptographic/application review, real-secret approval, public signing/distribution and legal review cannot be replaced by local tests.

The [2026-09-08 MVP plan](mvp-plan.md) and older batch plans are historical. Their online-only web and read-only-admin cut does not describe current installed-PWA and admin-write implementation. No broad backlog row is closed from a narrow acceptance pass.

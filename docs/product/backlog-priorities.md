# Backlog priority review

Current scope (2026-10-16): the user selected functionality-first internal acceptance with basic sanity checks. [Local code is accepted](../release/internal-functional-readiness-2026-10-16.md), including required individual-item deletion. The exhaustive matrix and supported-release conditions below remain coverage/follow-up work rather than the current internal-release criterion. No additional confirmed applicable P1 implementation blocker remains recorded.

Updated 2026-10-13. The user selected an internal fictitious-data release across server, web/PWA, extension, admin, desktop and CLI. **Windows and Linux are required; admin management writes are required.** This replaces the older conditional client scope and read-only-admin priority. The component [backlogs](README.md) retain their wider acceptance conditions.

See the [internal release candidate evidence and remaining gates](../release/internal-release-readiness-2026-10-13.md). Installed extension password-fill matrices pass on Windows Edge and Linux Chrome; basic installed desktop GUI acceptance passes on both platforms. Physical OS lock/idle, clean-machine/Linux package lifecycle, wider settings/device/type cases and human CA/browser acceptance remain open. Public beta and real-secret use have separate [release gates](../release/beta-readiness.md).

| Priority | Current meaning |
| --- | --- |
| P0 | Security/data-loss regression or a required runtime boundary for an explicitly selected mode |
| P1 internal | Blocks acceptance of a selected internal surface on Windows or Linux |
| P1 supported release | Installation, deployment and review required before a supported release |
| P2 | Optional expansion outside the internal acceptance cut |

## Do next — user-selected 2026-10-17

| Item | Outcome |
| --- | --- |
| [SRV-021](server-backlog.md#srv-021--private-tailscale-connectivity) | Support explicit private Tailscale endpoints across the published installer and clients, preserving loopback defaults and private-network security boundaries. Verify a published-package run between two computers. |
| SITE-006 in the [public site backlog](public-site-backlog.md) | Turn the published setup guide into a step-by-step checklist wizard with Next/Back navigation. List server-host prerequisites on the public website before downloads and guide customers through checking them, installation, activation and client connection. |
| DESK-012 in the [desktop backlog](desktop-backlog.md) | Add a supported macOS desktop app with secure native integration, published installation packages and clean-Mac acceptance. |
| EXT-013 in the [extension backlog](extension-backlog.md) | Support the existing extension in Chrome on macOS, including web-source fill and native messaging to the Mac desktop app, with offline and lock acceptance. |

These are open follow-up items; recording them does not change the published build or interrupt the current consumer acceptance run.

## Selected P1 closure order

**Blocking gate: complete cross-client sync verification.** The user's reported
queued-operation, comparison and source-connection failures supersede acceptance
claims based on isolated passing scenarios. Track the expanded scope and each
open case in the [sync release matrix](../release/internal-sync-release-plan-2026-10-13.md).

Windows/Linux packaged queued-conflict comparison and explicit selected-field resolution pass, with peer reads confirming the saved choice. Both platforms also pass peer-created settings review with immediate vault/collection view refresh. Wider default-view/device/interruption and clean-machine acceptance remain open.

| Order | Component and rows | Evidence and next action |
| --- | --- | --- |
| 1 | Extension EXT-002–005, EXT-007–009, EXT-012 | Real Windows Edge/Linux Chrome popup fill, split/React/shadow/frame forms, navigation refusal, desktop/CLI handoff, browser restart and source lock pass. Signup/ambiguous forms refuse before credential retrieval. Finish physical idle/OS lock, permission/repair, installed passkey-site and wider browser/accessibility cases. |
| 2 | Desktop DESK-004–008 | Windows/Linux native backend/keyring checks and basic installed GUI read/reveal/hide/edit/save/lock pass. Linux offline GUI edits survive process restart. Windows same-path update/reconnect and owned/foreign-registration uninstall pass. Finish clean-machine/Linux lifecycle and wider device/settings/disclosure cases. Shared-engine two-device tests close only part of DESK-004. |
| 3 | CLI CLI-003/004/006/008/009 | Both packages/keyrings, independent adopted-profile agents, second-device enrollment, conflicts/replay/checkpoints and default-redacted/explicit-password pipe output pass. Finish physical terminal, clean-machine and wider device/settings cases. |
| 4 | Web WEB-003/005–008 | Enrollment and installed-PWA offline recovery are implemented. Edge Rust/WASM fixture passes restart/conflict/replay and ownership acceptance. Finish intended-host CA/human ceremony, enabled type cross-client round trips and wider browser/accessibility matrix. Ordinary browser sessions remain online-only. |
| 5 | Admin SRV-016 | Schema-7 audited invitation/account/device/role/ownership writes pass PostgreSQL, HTTP, Edge and packaged HTTPS. Finish human acceptance. SMTP resend, secret settings and restore remain operator workflows. |
| 6 | Server SRV-002/003/005/013 | Extracted schema-7 guarded backup/restore and populated 1→7 migration pass. Unrelated-host/Docker/private-LAN, operational shutdown/upgrade and backup-key custody remain supported-release gates. |

Admin management writes have been implemented during this window. The contract includes confirmations, fresh operator passwords, exact Origin/CSRF, redacted audit, exact replay receipts and concurrent last-owner protection. Local console operators remain distinct from enrolled account roles. Ownership requires the recipient's own freshly authenticated acceptance.

## Scope boundaries

- API-first server hardening is a user-selected **post-MVP priority**, tracked in
  [SRV-020](server-backlog.md#srv-020--api-first-server-boundary-post-mvp-priority).
  It preserves a future independently hosted client option; hosted PWA delivery
  and cross-origin browser access remain deferred and do not block this MVP.
- Shared vaults and native iOS/Android/iPad delivery remain excluded. Work is a second private vault.
- Cloud rows remain P0 **for Cloud**, but Cloud startup remains closed and is outside this self-hosted candidate.
- Public site commercialization, optional table output, drag-to-fill and wider import/export do not block this internal cut.
- Enabled license behavior must preserve reads and encrypted pending work. Production entitlement/clock/restore policy remains in SRV-017/018 and the supported-release gate.
- Independent cryptographic/application review, real-secret approval, public signing/distribution and legal review cannot be replaced by local tests.

The [2026-09-08 MVP plan](mvp-plan.md) and older batch plans are historical. Their online-only web and read-only-admin cut does not describe current installed-PWA and admin-write implementation. No broad backlog row is closed from a narrow acceptance pass.

# Self-hosted ease-of-use implementation

User-selected scope: all 50 points. Implement and commit in coherent batches. Keep intermediate packages internal; publication is separate. Existing unrelated release-cache work is preserved. A point is complete only with implemented behavior or verified existing behavior and recorded evidence.

## 1. Combined installer

- [x] 1.1 Role-based entry: server, join, update/repair.
- [x] 1.2 Recommended components with customization.
- [x] 1.3 Import shared connection file during joining.
- [x] 1.4 Preflight prerequisites and restart guidance.
- [x] 1.5 Resume installation without repeating completed steps.

## 2. Joining users

- [x] 2.1 Protected client downloads without purchaser setup credentials.
- [x] 2.2 Shareable joining page and instructions.
- [x] 2.3 Explain invitation, connection and approval separately.
- [x] 2.4 OS choice and recommended installer.
- [x] 2.5 Joining completion checklist.

## 3. Desktop

- [ ] 3.1 Staged first-run joining wizard.
- [ ] 3.2 Primary file import with advanced manual setup.
- [ ] 3.3 Confirm recognizable server identity.
- [ ] 3.4 Pending approval code and trusted-device instructions.
- [ ] 3.5 Resume onboarding without retaining credentials.

## 4. Web app

- [ ] 4.1 Invitation-led account creation.
- [ ] 4.2 First-owner setup only when needed.
- [ ] 4.3 Recovery/vault/device onboarding checklist.
- [ ] 4.4 Prominent reviewed device approval.
- [ ] 4.5 Post-registration client downloads and connection guidance.

## 5. Server admin

- [ ] 5.1 Add a person wizard.
- [ ] 5.2 Connection file plus copyable joining message.
- [ ] 5.3 Invitation lifecycle visibility.
- [ ] 5.4 Reachability checks before sharing.
- [ ] 5.5 Server readiness checklist.

## 6. Extension

- [ ] 6.1 Detect and recommend a source.
- [ ] 6.2 Remember source preference.
- [ ] 6.3 Open/unlock/reconnect actions.
- [ ] 6.4 Guided install and connector repair.
- [ ] 6.5 Prepare browser-store distribution.

## 7. Installation handoff

- [x] 7.1 Component-specific completion results.
- [ ] 7.2 Installed, needs setup and ready states.
- [ ] 7.3 Correct next action after installation.
- [ ] 7.4 Safe connection handoff without credentials.
- [ ] 7.5 Resumable remaining-work checklist.

## 8. Connection failures

- [ ] 8.1 Actionable server/network/Tailscale errors.
- [ ] 8.2 Preserve trust and explain identity changes.
- [ ] 8.3 Distinguish account/approval/revocation errors.
- [ ] 8.4 Role-appropriate license guidance.
- [ ] 8.5 Deliberately shared redacted diagnostic report.

## 9. Browser certificate trust

- [ ] 9.1 Explain application versus browser trust.
- [ ] 9.2 Platform-specific browser trust guides.
- [ ] 9.3 Obtain public CA and verification information.
- [ ] 9.4 Approval using existing trusted device.
- [ ] 9.5 Connection check without certificate bypass.

## 10. Server ownership

- [ ] 10.1 Guided encrypted-backup scheduling.
- [ ] 10.2 Backup success/failure/restore visibility.
- [ ] 10.3 Certificate expiry and guided renewal.
- [ ] 10.4 Update compatibility/backup/downtime preview.
- [ ] 10.5 Guarded restore/migration preserving identity.


Batch 1 evidence: installer journey module, role recommendations, bounded public connection import, prerequisite preview/restart instructions and existing atomic installation receipts; protected client-download grants with expiry/revocation and explicit denial of server/license/billing endpoints; joining page with OS recommendations and non-secret checklist. `cargo test -p vaults-installer`, installer Clippy, client-download unit tests and the Worker HTTP authorization regression pass. Remaining handoff details stay open below.

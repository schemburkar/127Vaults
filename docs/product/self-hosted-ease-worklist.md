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

- [x] 3.1 Staged first-run joining wizard.
- [x] 3.2 Primary file import with advanced manual setup.
- [x] 3.3 Confirm recognizable server identity.
- [x] 3.4 Pending approval code and trusted-device instructions.
- [x] 3.5 Resume onboarding without retaining credentials.

## 4. Web app

- [x] 4.1 Invitation-led account creation.
- [x] 4.2 First-owner setup only when needed.
- [x] 4.3 Recovery/vault/device onboarding checklist.
- [x] 4.4 Prominent reviewed device approval.
- [x] 4.5 Post-registration client downloads and connection guidance.

## 5. Server admin

- [x] 5.1 Add a person wizard.
- [x] 5.2 Connection file plus copyable joining message.
- [x] 5.3 Invitation lifecycle visibility.
- [x] 5.4 Reachability checks before sharing.
- [x] 5.5 Server readiness checklist.

## 6. Extension

- [x] 6.1 Detect and recommend a source.
- [x] 6.2 Remember source preference.
- [x] 6.3 Open/unlock/reconnect actions.
- [x] 6.4 Guided install and connector repair.
- [x] 6.5 Prepare browser-store distribution.

## 7. Installation handoff

- [x] 7.1 Component-specific completion results.
- [x] 7.2 Installed, needs setup and ready states.
- [x] 7.3 Correct next action after installation.
- [x] 7.4 Safe connection handoff without credentials.
- [x] 7.5 Resumable remaining-work checklist.

## 8. Connection failures

- [x] 8.1 Actionable server/network/Tailscale errors.
- [x] 8.2 Preserve trust and explain identity changes.
- [x] 8.3 Distinguish account/approval/revocation errors.
- [x] 8.4 Role-appropriate license guidance.
- [x] 8.5 Deliberately shared redacted diagnostic report.

## 9. Browser certificate trust

- [x] 9.1 Explain application versus browser trust.
- [x] 9.2 Platform-specific browser trust guides.
- [x] 9.3 Obtain public CA and verification information.
- [x] 9.4 Approval using existing trusted device.
- [x] 9.5 Connection check without certificate bypass.

## 10. Server ownership

- [ ] 10.1 Guided encrypted-backup scheduling.
- [ ] 10.2 Backup success/failure/restore visibility.
- [ ] 10.3 Certificate expiry and guided renewal.
- [ ] 10.4 Update compatibility/backup/downtime preview.
- [ ] 10.5 Guarded restore/migration preserving identity.


Batch 1 evidence: installer journey module, role recommendations, bounded public connection import, prerequisite preview/restart instructions and existing atomic installation receipts; protected client-download grants with expiry/revocation and explicit denial of server/license/billing endpoints; joining page with OS recommendations and non-secret checklist. `cargo test -p vaults-installer`, installer Clippy, client-download unit tests and the Worker HTTP authorization regression pass. Remaining handoff details stay open below.

Batch 2 evidence: Add a person reuses the fresh-password, idempotent invitation ceremony and adds a connection-file/client-download/instruction sharing kit. Server-only refresh credentials stay behind the local admin API; trial operators can paste a client-only Manage link. Connection readiness distinguishes local-only addresses and expiring certificates without claiming remote reachability. Existing invitation state queries and readiness counts are verified. Admin handler/directory, joining-kit and delegation tests pass.

Batch 3 evidence: Desktop starts incomplete profiles in staged onboarding, previews the server name/address, gates owner setup on a pinned HTTPS check, displays approval codes, and resumes from trust/device receipts without retaining setup credentials. Web invitations and first-owner gates already pass the enrollment suite; added post-registration guidance and an accessible recovery/vault/device checklist with the existing reviewed approval flow. Shared error guidance retains trust and local data; reports contain only allowlisted status categories/booleans. Admin exports the public CA with its exact-file fingerprint; browser trust guides cover Windows/Linux and future macOS, and the web app checks only its own HTTPS server without bypassing TLS. Desktop check +51 tests, web check +95 tests and diagnostic redaction tests pass.

Batch 4 evidence: extension source detection now preserves an explicit non-secret preference across popup restarts, explains fallback, and retains existing safe open/unlock/reconnect controls. Repair instructions lead to the existing installer connector-registration flow; redacted reports are opt-in. Packaging prepares a permission/asset-validated store review manifest without publishing or inventing store IDs. Installer saves per-component handoff after each durable state change, separates installed from needs-setup and user-confirmed ready, supports a no-credential local checklist review, and launches installed Desktop with only a validated public connection file that still requires review in the app. Installer tests/Clippy, extension tests, and store-preparation regression pass.

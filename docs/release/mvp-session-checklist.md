# Internal release to supported MVP: session checklist

Prepared 2026-10-19. This is a session guide for the existing component backlogs,
not a replacement status tracker or release approval. Start each session by
checking current code, package versions and private evidence; reuse passing
evidence where it covers the exact scenario. Fix reproduced gaps and record
remaining gates honestly. A session may need more than one sitting.

Scope: first supported self-hosted Windows/Linux release, including desktop,
CLI, web/installed PWA, password-fill extension and selected admin writes.
Public beta, paid commerce and macOS have additional sessions below.

## Working rules for every session

- Record the selected revision, artifact versions, platforms, scenarios and results.
- Use disposable accounts and sample vaults for destructive/failure scenarios.
- Preserve existing installations, unrelated changes and private operational data.
- Run relevant checks and commit completed changes to local main; do not push.
- Keep candidate builds internal. Publish only one combined release after the
  relevant fixes and acceptance pass, with publication authorization.
- Update the owning component backlog with evidence and precise remaining work.
  Keep sensitive evidence in the existing private records rather than Git.

## 01 — Offline sync and conflict losslessness

Owners: DESK-004, CLI-003/004, WEB-005/006; current sync release matrix.

- Reconcile the open sync matrix with existing Windows/Linux evidence.
- Exercise desktop, CLI and installed PWA in representative cross-client pairs:
  different-field edits, same-field conflicts, delete-versus-edit and repeated sync.
- Queue offline edits, restart clients, interrupt reconnect and simulate a lost
  response; confirm retries neither duplicate nor discard accepted operations.
- Verify explicit field choices from a peer, pending counts, checkpoint continuity
  and preservation of unresolved work after errors.
- Fix failures and add regression coverage for each reproduced defect.

Done when: the agreed supported-client matrix passes, peer reads confirm final
content, and every pending operation is either applied or visibly unresolved.
Requires: two enrolled devices/profiles and a disposable server.

## 02 — Vault settings, item types and archive/move consistency

Owners: DESK-008/009, CLI-005/009/010, WEB-003, SRV-014/015.

- Round-trip every advertised item type between desktop, CLI and web; verify
  grouped/custom fields and absent legacy type markers survive edits.
- Test vault/collection names, all-vault views and synchronized default views
  across two devices, including concurrent offline settings and restart.
- Test advertised archive, restore and move workflows with pending-edit refusal,
  interruption during copy/finalization, durable resume and peer verification.
- Check Wi-Fi QR with a real scanner if advertised; document current move limits.

Done when: advertised workflows preserve fields and settings across clients and
recover from interruption without losing or silently hiding items.
Depends on: 01. Optional features can instead be explicitly excluded from MVP.

## 03 — Fresh-host installation, private connectivity and setup wizard

Owners: SRV-005/010/012/021, SITE-006, WEB-007.

- Select the exact supported OS/container-engine combinations; distinguish
  required support from candidate combinations such as Docker.
- On clean Windows/Linux hosts, follow only public instructions and candidate
  packages: prerequisites, verification, init/start/status, license and owner setup.
- Exercise missing prerequisites, insufficient privileges, conflicting ports,
  incomplete setup, reboot/resume and failed-step recovery.
- On a second computer, complete private Tailscale discovery, actual browser CA
  trust, enrollment, approval, sync and offline recovery.
- Verify wrong CA/Host/Origin and unintended-interface access fail closed.
- Repair wizard/runbook gaps exposed by the run.

Done when: a recipient completes each advertised path without developer fixes or
certificate-warning bypasses, and failure instructions are actionable.
Requires: clean hosts, a second computer and interactive certificate approval.

## 04 — Upgrade, backup and unrelated-host recovery

Owners: SRV-002/003/005/006/013; desktop/CLI package lifecycle rows.

- Upgrade an existing populated installation using candidate packages; verify
  identity, CA, users, license, device enrollment and known encrypted item reads.
- Test migration refusal, interrupted upgrades, safe shutdown with queued work
  and the documented rollback/recovery procedure.
- Back up database and installation identity separately; document encryption-key
  custody, scheduling, retention and operator responsibilities.
- Restore onto an unrelated empty host, reject accidental overwrite and verify
  browser login plus reconnection/sync from a previously enrolled client.
- Exercise database outage and recovery; make diagnostics useful and redacted.

Done when: the documented recovery drill restores usable data and trust on another
host, and failed upgrades have a verified safe recovery route.
Depends on: 03; requires separate backup storage and disposable restore target.

## 05 — Locking, device lifecycle and secret exposure

Owners: DESK-006/007, CLI-006/008, EXT-001/002/004/005/007/008/012.

- Physically test OS lock, idle timeout, explicit lock, late unlock cancellation,
  browser/service-worker restart and desktop/CLI source switching on Windows/Linux.
- Verify password fill refuses after lock, navigation/origin changes and invalid
  source state; verify offline fill through a hydrated installed replica.
- Test enrollment approval/rejection, revocation, stale sessions and independent
  agent profiles; document offline revocation limits.
- Complete the credential-rotation/recovery contract and selected client UX,
  then test success, interruption and old-credential rejection.
- Review clipboard, WebView, local storage, connector messages and logs for secret
  exposure; verify native-host permission repair and removal.
- Review experimental website passkeys separately if included in the release;
  otherwise explicitly exclude them from supported claims.

Done when: the supported lock/device matrix passes and exposure/recovery findings
are resolved or explicitly block release. Independent review remains session 09.
Requires: interactive OS sessions; depends on 01 and available server ceremonies.

## 06 — Browser, accessibility and package lifecycle acceptance

Owners: WEB-006/008, DESK-005/008, CLI-008, EXT-005/009.

- Declare supported browser/OS versions and test onboarding, unlock, edit, sync,
  conflict, lock and error states in that matrix.
- Verify installed-PWA offline restart and distinguish ordinary online-only tabs.
- Walk keyboard/focus and screen-reader paths; check narrow layouts, long labels,
  empty/loading states, stale data and actionable errors.
- Test clean client install, same-profile update, reconnect, repair and uninstall
  on Windows/Linux, preserving data and unrelated native-host registrations.
- Complete a real terminal/keyring walkthrough, including redacted default output
  and explicitly requested secret output.

Done when: advertised client packages and primary workflows pass the supported
matrix, with installation and accessibility defects fixed.
Depends on: 01–05 for the final combined pass.

## 07 — Invitations, admin and operational handoff

Owners: SRV-009/011/016, SITE-007 where selected.

- Verify real external SMTP-over-TLS invitation delivery and activation from the
  packaged server, including expired/revoked/duplicate invitations and failures.
- Complete human owner/admin workflows: account state, device revocation, roles,
  ownership acceptance, stale sessions and last-owner protection.
- Verify denial/audit/redaction behavior and explain which tasks remain operator
  commands, including SMTP secrets, resend and restore.
- Finish operator runbooks for health, backup checks, outage response, diagnostics
  and support handoff; verify configured operator email delivery if included.

Done when: real recipients can enroll and operators can manage and recover the
advertised deployment using the documented tools.
Depends on: 03–05; requires a real SMTP provider and recipient inboxes.

## 08 — License enforcement and safe renewal

Owners: SRV-017/018, WEB-009, DESK-010, CLI-012, EXT-010.

- Finalize license-sequence rollback protection, clock/restore policy, expiry,
  grace, revocation and bounded emergency export behavior.
- Verify concurrent invitation/seat accounting, renewal, upgraded licenses, signing
  key rotation and restored/older license rejection.
- Make plan/expiry/grace/lock and renewal instructions clear in each client;
  define offline cached-status and stale-session behavior.
- Prove reads/recovery remain available and encrypted local data/pending edits
  survive expiry, license replacement and renewal.

Done when: enforcement matches a documented policy and the adverse-condition
matrix passes without loss of vault data or pending work.
Required for: production licensing/paid release; dependencies 01, 04 and 05.

## 09 — Public-beta crypto and application review

Owners: SRV-004/007/008/011, component security rows; beta-readiness gate.

- Freeze versioned crypto/protocol formats, deterministic vectors, compatibility
  rules and migration expectations for existing encrypted data.
- Prepare a review packet covering authentication, key custody, device lifecycle,
  authorization, sync replay/fork/rollback, client boundaries and recovery.
- Commission independent crypto/application review; track findings, implement
  fixes and obtain reviewer verification where required.
- Complete dependency/advisory and container review, image pinning, secret/history
  checks and required credential rotation; exercise adverse-condition scenarios.

Done when: required independent review and release-security findings are accepted
with evidence. Local automated tests alone cannot close this session.
Requires: external reviewers and any necessary budget/scheduling authorization.
Depends on: a stable candidate from 01–08 as applicable.

## 10 — Signed release candidate and final shipping decision

Owners: SITE-002, release gates and first-public-beta checklist.

- Freeze supported scope, platforms, versions and remaining experimental limits.
- Reproduce combined artifacts from the selected commit; verify notices, licenses,
  hashes, signatures, signing-key instructions and server/client compatibility.
- Verify consumer-download bytes and repeat fresh-install/update/recovery checks
  against the actual selected artifacts, not an earlier development build.
- Finish legal review, release notes, support/recovery instructions and the final
  gate record. Obtain the selected supported/public release decision.
- Publish one combined release only when authorized and its gates pass; verify
  the resulting public site/private catalogue and retain reproducible evidence.

Done when: the selected release has an explicit decision, verified artifacts and
accurate distribution/support claims.
Depends on: 01–07; 08 for production licensing and 09 for public beta.

## 11 — Optional paid self-hosted launch

Owners: SITE-001/003/004 and self-hosted customer journey.

- Complete privacy/retention/deletion, verified customer identity, abuse controls
  and production issuer-key custody/recovery.
- Complete merchant onboarding and reviewed commercial/tax/refund terms.
- Implement server-created orders and verified idempotent payment reconciliation;
  test failure, duplicates, delay, cancellation, refunds and disputes.
- Complete customer orders/invoices, installation binding, license delivery,
  renewal, replacement authorization and old-install revocation/support flows.
- Rehearse the entire purchase-to-install-to-renew journey before enabling sales.

Done when: real payment and customer operations produce only authorized
entitlements and recovery/support work end to end.
Depends on: 08–10 and external merchant/legal setup. Unpaid trials do not require
completion of the paid-checkout work.

## 12 — Conditional macOS support

Owners: DESK-012, EXT-013; macos-preparation runbook.

- Obtain an authorized Mac build route; run Intel/Apple Silicon compile/tests
  for each advertised architecture and fix platform-specific failures.
- Test Keychain, native agent/Chrome messaging, device enrollment, offline edits,
  conflicts, restart, physical OS lock/idle and connector repair/removal.
- Set up authorized Developer ID signing/notarization; verify signed and stapled
  packages, then clean-Mac install/update/uninstall with data preservation.
- Add Mac distribution and setup claims only after actual package acceptance.

Done when: each advertised Mac architecture passes the same applicable supported
client checks. Preparation alone does not establish Mac support.
Requires: Mac access, Apple signing account and separately authorized remote
runner/repository/signing setup. Needed only if Mac is in the MVP platform scope.

## Suggested session sequence

Start 01 → 02 → 03 → 04 → 05 → 06 → 07, then 10 for the supported-release
decision. Include 08 before production licensing, 09 before public beta, 11
before paid sales and 12 before claiming Mac support. Arrange external review
and Mac resources early because their availability is outside local coding work.

For a later chat, use: “Work on MVP session 01 from
docs/release/mvp-session-checklist.md. Check current evidence, finish the applicable
tasks, update the owning backlog, run relevant checks and commit to local main.
Keep candidate builds internal.” Replace the session number as needed.

# Executable implementation batches

> Historical execution plan. Current work and status are in the [component work index](README.md). Completed batch evidence remains linked below; do not use the old handoff as a live queue.

Use this file with [the implementation backlog](implementation-backlog.md). Backlog IDs define outcomes; this file defines execution.

## Agent dispatch policy

- Use `gpt-5.6-sol` low for all remaining implementation batches.
- Reserve `gpt-6-astra` low for the post-MVP security review; escalate beyond low only if that review identifies a specific exceptional problem.
- Read this file, named references, relevant ADRs, and the working tree first.
- Preserve unrelated work. Do not commit, push, publish, use real data, or mark a wider outcome complete from fixture evidence.
- Do not overlap owned paths. Report changed files, checks, evidence, deferred tests, and backlog changes.
- Do not add ports or weaken boundaries to bypass incomplete behavior. Run stated smoke checks and record deferred automation.

## Current handoff

Batches 1, 2, 3A, 3B, 3C0, disposable 3C1/3C, Batch 4, Batch 5A,
and Planning Batches P1–P4 are complete. Internal-MVP implementation through
Batch 7 is complete; the final browser ceremony and private-LAN trust matrix
require human CA trust. Batch 8A is post-MVP expansion.

## Planning Batch P1 — authentication and sessions

**Status/model:** Complete. `gpt-6-astra` low; no code.

**Task:** Complete 5A evidence and freeze the OPAQUE composition, account-secret handling, server identity/transcript binding, protocol limits, enumeration behavior, credential epochs, and session contract. Specify a host-local owner-lockout reset that clears only failure state.

**Output/acceptance:** [Authentication protocol](../security/mvp-authentication-protocol.md) and ADR-0014/0015/0020 fix the application/session/lockout contract. Q-002/Q-003 are closed; Q-001 is narrowed to 5A dependency probes and vectors.

## Planning Batch P2 — onboarding, identity, transport

**Status/model:** Complete. `gpt-6-astra` low; no code.

**Task:** Specify account-secret printable/QR encoding, first-browser identity and wrapping lifecycle, bootstrap/invite/email-code formats and atomic consumption, verified SMTP activation, and local-CA HTTPS provisioning/renewal.

**Output/acceptance:** [Onboarding and transport](../security/mvp-onboarding-transport.md) and ADR-0003/0012/0016 provide exact encodings, bounds, failure states, trusted inputs, and operations. Q-004/Q-005/Q-007 are closed.

## Planning Batch P3 — private-vault persistence

**Status/model:** Complete. `gpt-6-astra` low; no code.

**Task:** Freeze the account/vault key envelopes, authenticated manifest binding exact index/body revisions, trusted context source, atomic publication, expected-base updates, idempotent request IDs, API bounds, and metadata-only audit events.

**Output/acceptance:** [Private-vault contract](../architecture/private-vault-contract.md), key hierarchy, and sync protocol define create/list/read/update behavior and rollback limitations. Delete is excluded until trash exists. Q-006 is closed.

## Planning Batch P4 — internal-MVP readiness review

**Status/model:** Complete by central reconciliation. `gpt-6-astra` low; no code.

**Task:** Trace every internal-MVP acceptance criterion to one executable batch, resolve cross-document contradictions, confirm dependency order and path ownership, and leave later feature gates explicit.

**Output/acceptance:** This file, the MVP plan, open decisions, and next-session handoff agree. No implementation gate is hidden in prose and no later sync/sharing/recovery work blocks the internal MVP.

## Batch 1 — one-command local development

**Status/model:** Complete; Podman Windows existing-installation smoke verified. `gpt-5.6-sol` low.

**Backlog IDs:** DEP-008–DEP-018, TEST-004, TEST-005.

**Evidence:** `pnpm dev:up`, `pnpm dev:status`, and `pnpm dev:down`; see [experimental development](../release/experimental-development.md).

**Acceptance/limits:** Initialization accepts only empty or expected schemas; repeated startup preserves `.env`, identity, and database volume; stopped status fails clearly; output reveals no credentials and invents no owner. Isolated failure fixtures passed. Clean-machine Podman setup, credential generation, provider discovery, Docker automation, and dependency installation remain open.

## Batch 2 — execute the Rust core in a browser

**Status/model:** Complete and browser verified. `gpt-6-astra` low.

**Depends on:** Batch 1.

**Backlog IDs:** CRY-001, CRY-002, DEP-006, DEV-010, TEST-006.

**Evidence:** [Batch 2 reproduction](../release/rust-browser-fixture.md).

**Acceptance/limits:** The page loads real Rust WASM, creates only a disposable fixed secret fixture, validates opaque handles, and proves locking permanently invalidates old handles. Load failure is visible. No secret reader, persistence, login, stable format, production zeroization claim, or real data.

## Batch 3A — crypto dependency evidence

**Status/model:** Complete and centrally reviewed. `gpt-6-astra` low.

**Depends on:** Batch 2.

**Backlog IDs:** CRY-001–CRY-003, CRY-005, TEST-001.

**Task:** Maintain primary-source evidence for Argon2id, XChaCha20-Poly1305, Ed25519, X25519, HKDF/hash, entropy, zeroization, WASM, and transitive risks. Keep OPAQUE separate. Do not select parameters or add code.

**Acceptance:** [Dependency evidence](../security/crypto-dependency-evidence.md) records maintenance, audits, MSRV, targets, entropy failure, supply-chain risks, candidates, rejections, and gaps.

## Batch 3B — experimental format specification

**Status/model:** Complete and accepted for disposable implementation. `gpt-6-astra` medium; exceptional gate 1 of 3.

**Depends on:** Batch 3A.

**Backlog IDs:** CRY-003, CRY-007–CRY-013, TEST-002.

**Task:** Maintain the non-OPAQUE ECF1 specification: KDF inputs and ceilings, salts, hierarchy, domains, canonical contexts, AEAD sizes, entropy failure, UUIDs, versions, parser limits, errors, downgrade refusal, and disposal.

**Acceptance/exclusions:** [ECF1](../security/experimental-crypto-format.md) covers nonce reuse, ambiguity, substitution, malformed input, rollback, memory, WASM exposure, and deferred vectors. It approves no dependency or stable format.

## Batch 3C0 — exact dependency and feature selection

**Status/model:** Complete and accepted for disposable ECF1. `gpt-6-astra` low.

**Depends on:** Batches 3A and 3B.

**Backlog IDs:** CRY-001, CRY-003, CRY-007, TEST-003.

**Task:** Maintain exact minimal native/WASM versions and features, complete target graphs, MSRV, licenses, provenance, advisories, unsafe/build/proc-macro surfaces, feature unification, and audit gaps.

**Acceptance:** [Exact dependency selection](../security/ecf1-dependency-selection.md) requires caller-owned zeroizing Argon2 workspace memory and documented pins.

## Batch 3C1 — matched wasm-bindgen upgrade

**Status/model:** Implemented for disposable experiments; release approval open. `gpt-6-astra` low.

**Depends on:** Batch 3C0 and the accepted [toolchain review](../release/wasm-toolchain-review.md).

**Backlog IDs:** CRY-001, CRY-002, DEP-002, DEP-003, TEST-006.

**Task:** Upgrade the fixture Rust package and workspace-local CLI as one exact `wasm-bindgen 0.2.126` pair. Limit changes to required manifests, lockfile, helper checks, generated ignored bindings, and installation guidance. Review the dependency diff; run available locked Rust/WASM, TypeScript, browser, mismatch, redaction, and reproducibility checks.

**Acceptance/exclusions:** Versions match exactly; mismatches fail closed; the browser fixture still passes; unverified clean-environment/browser checks remain explicit. Preserve fixture API and warnings. Do not implement ECF1 or claim WASM is a secret boundary.

## Batch 3C — experimental Rust encryption

**Status/model:** Complete for disposable use; release remains blocked by 3C1 CLI findings. `gpt-6-astra` low.

**Backlog IDs:** CRY-001–CRY-003, CRY-007–CRY-013, TEST-002, TEST-006.

**Task:** Implement only accepted ECF1 in the Rust core and narrow WASM adapter.

**Acceptance/exclusions:** Native/browser round trips cover wrong context, tamper, malformed envelopes, entropy failure, limits, lock invalidation, and redacted errors. Run fmt, strict Clippy, native/WASM/browser smoke. Export no raw-key reader; keep stable formats empty. No OPAQUE, accounts, persistence, or sync.

**Evidence:** [Disposable ECF1 implementation](../release/ecf1-experimental.md). Native, generated-WASM, and real-browser worker smoke pass. Stable independent cross-implementation vectors remain a later format-freeze gate.

## Batch 4 — disposable encrypted login-item flow

**Status/model:** Complete for disposable use; production persistence remains Batch 7. `gpt-5.6-sol` low.

**Backlog IDs:** ITEM-002–ITEM-004, ITEM-010, DEV-009–DEV-012, REL-003, TEST-008, TEST-009.

**Task:** Build a disposable browser demo using real ECF1 Rust/WASM and existing session components. Create/edit fictitious login data; encrypt before storage; show only the envelope; reload, unlock, decrypt; clear UI and handles on lock.

**Acceptance/exclusions:** Run syntax, type, Rust/WASM, and browser smoke and document reproduction. No auth, server persistence, sharing, real data, or stable claims.

**Evidence:** [Disposable encrypted login-item flow](../release/disposable-login-item.md). Real-browser create, encrypted storage, lock, reload/unlock/decrypt, edit, and second-lock cleanup pass. The known workspace TypeScript ACL failure remains unrelated and explicit.

## Batch 5A — OPAQUE feasibility and ceremony design

**Status/model:** Complete for internal MVP; public-beta security review remains. `gpt-5.6-sol` low.

**Depends on:** Batch 3A.

**Backlog IDs:** CRY-004–CRY-006, AUTH-002–AUTH-009.

**Task:** Execute the research and protocol probes frozen by P1: assess RFC-aligned Rust/WASM OPAQUE, audits, versions, suites, registration/login/update, malformed messages, migration, and DoS ceilings.

**Acceptance/exclusions:** Recorded in [OPAQUE feasibility evidence](../security/opaque-feasibility-evidence.md). Exact-tag RFC vectors, 84 upstream tests, native/WASM probes and exact-lock RustSec audit pass. The unaudited 4.x delta blocks public-beta approval. No product code or dependencies were added.

## Batch 5B — authentication protocol and implementation

**Status/model:** Implementation and loopback runtime complete; final human
browser ceremony and private-LAN matrix remain. See 5B evidence (internal record retained outside Git).
`gpt-5.6-sol` low.

**Backlog IDs:** AUTH-001–AUTH-009, CRY-004–CRY-009, CRY-013–CRY-015, TEST-010.

**Task:** Implement the P1 authentication/session protocol through Rust/WASM and TypeScript. Register the first browser identity during account onboarding; bind sessions to account, device, credential epoch, version, transcript, and server identity; enforce limits and delays.

**Acceptance/exclusions:** With fictitious accounts verify success, wrong secrets, tamper, replay, unknown-account behavior, concurrency, and lock cleanup. The server receives no master password, account secret, root/vault key, or plaintext. No invitations, MFA, recovery, or sharing.

## Batch 5T — private HTTPS transport

**Status/model:** Loopback runtime accepted; human CA trust/private-LAN matrix pending. `gpt-5.6-sol` low.

**Depends on:** P2 and Batch 1. Must complete before usable 5B/6 LAN acceptance.

**Backlog IDs:** DEP-009–DEP-013, REL-009, TEST-011.

**Task:** Implement the specified loopback and private-LAN HTTPS modes. Pin and review the certificate helper; protect CA/server keys; enforce Host, Origin, SNI and private-address policy; document explicit trust and renewal operations.

**Acceptance/exclusions:** Verify Podman startup, key-file permissions, trusted and untrusted browser flows, renewal, wrong Host/Origin/SNI, and refusal of public/custom-domain exposure. No cloud proxy or public certificate mode.

**Evidence:** Static policy and server tests pass; see private HTTPS evidence (internal record retained outside Git).
Do not claim LAN support until its human runtime matrix passes. Immutable helper-image digest review remains a public-beta gate.

## Batch 6 — owner bootstrap and invitation redemption

**Status/model:** Complete for the loopback internal MVP, including TLS SMTP invited-user activation/login and two-account isolation. `gpt-5.6-sol` low.

**Backlog IDs:** IAM-001–IAM-011, AUTH-001, TEST-010.

**Task:** Replace provisional staging with authenticated first-owner bootstrap and one invitation path. Require the local single-use setup secret; enforce username rules, verified SMTP email proof, 24/48-hour expiry, email/count binding, one redemption per email, ordinary-user default, replay/race safety, and owner invariant. Permit fake mail only in test adapters.

**Acceptance/exclusions:** Run database/HTTP/SMTP smoke with fictitious data; avoid unnecessary code/identity logs. Preserve migration safety. Defer hosted relay and role management.

**Evidence:** Static checks, the 18-test server suite and owner loopback flow pass; see onboarding evidence (internal record retained outside Git). The mounted handler is wired to Batch 5B's reviewed registration/device-proof completion adapter.

## Batch 7 — private vault and encrypted persistence

**Status/model:** Implementation and automated live acceptance complete; final
human browser ceremony pending local-CA trust. `gpt-5.6-sol` low.

**Backlog IDs:** CRY-009–CRY-013, ITEM-001–ITEM-004, ITEM-010, REL-003, TEST-007–TEST-009.

**Task:** Implement one private vault and encrypted login-item create/list/read/update for one authenticated browser profile using PVD1/PVM1 from the P3 contract. Generate keys only in Rust; persist only versioned ciphertext/public metadata; verify catalogue/body commitments while listing and decrypt/verify the body only when opened.

**Acceptance/exclusions:** Composition vectors pass; atomic directory/manifest/index/body publication and expected-base updates hold; mismatched pairs are rejected while the latest verified in-session version remains; lock clears UI and handles; PostgreSQL contains no plaintext. No delete, rollback guarantee across fresh sessions, signed sync, sharing, history, conflicts, second device, or offline-web claim.

## Batch 8A — signed operation log

**Status/model:** Post-MVP expansion; ready after human MVP acceptance. `gpt-5.6-sol` low.

**Backlog IDs:** SYNC-001–SYNC-003, SYNC-013–SYNC-015, SYNC-022, TEST-016.

**Task:** Implement random operation IDs, device signatures, canonical encoding, idempotent submission, causal bases, server ordering, HTTPS fetch, cursors, data-free WebSocket notifications, polling fallback, and bounded reconnect.

**Acceptance/exclusions:** Reject malformed, byte-divergent duplicate, replayed, unauthorized, wrong-vault/epoch, and invalid-signature operations. Timestamps are informational. Defer conflict merge.

## Batch 8B — conflicts and snapshots

**Status/model:** Blocked by Batch 8A. `gpt-5.6-sol` low.

**Backlog IDs:** SYNC-004–SYNC-012, SYNC-016, SYNC-017, SYNC-019–SYNC-024.

**Task:** Implement different-field merge; same-field A/B/both with `Copy`; indefinite conflict UI; field edit blocking; delete-conflict item blocking; 30-day cursors; verified snapshots; pending-op rebase; and affected-vault freeze.

**Acceptance/exclusions:** Never select by timestamp. Use two simulated clients only when needed. Preserve verified offline reads and recovery evidence. Defer shared repair and optional transparency notary.

## Batch 9 — device enrollment and revocation

**Status/model:** Blocked by Batches 5B and 8A. `gpt-5.6-sol` low.

**Backlog IDs:** DEV-001–DEV-007, DEV-015, AUTH-002, CRY-015, REC-009–REC-011, REL-004.

**Task:** Extend the first browser identity delivered in 5B with trusted-device enrollment by entered code or QR, account secret/master password, signatures, epochs, and replay-safe approval. Add revocation, secret rotation with reenrollment, and opt-in signed best-effort wipe. For web MVP, store only a software-protected encrypted identity and require both secrets each new session without hardware claims.

**Acceptance/exclusions:** Verify expiry, substitution, replay, revoked queues, and concurrent rotation with software test adapters. Platform hardware keys and software-backed Linux persistence remain deferred.

## Batch 10 — sharing and vault epochs

**Status/model:** Blocked by Batches 8B and 9. `gpt-5.6-sol` low.

**Backlog IDs:** SHARE-001–SHARE-009, CRY-010–CRY-012, SYNC-018–SYNC-020.

**Task:** Implement same-server read/write/manager/owner roles, accepted transfer, owner protections, no implicit admin access, per-member/device key wrapping, removal rotation, and rejection of removed-member operations.

**Acceptance:** Verify authorization, membership/transfer races, old epochs, and owner invariants with fictitious data.

## Batch 11A — deletion and history

**Status/model:** Blocked by Batches 8B and 10. `gpt-5.6-sol` low.

**Backlog IDs:** RET-001–RET-010.

**Task:** Implement item trash/history, shared-vault four-hour read-only pending deletion, 24-hour recovery, private-vault recovery state, owner/admin cancellation, purge, retention ceilings, and last-ten-password retention.

**Acceptance:** Use an injected clock. Admin restore stays control-plane-only. Record deferred exhaustive tests.

## Batch 11B — selected-admin recovery

**Status/model:** Blocked by Batches 9 and 10. `gpt-5.6-sol` low.

**Backlog IDs:** AUTH-010, AUTH-011, REC-001–REC-008, SYNC-018, SYNC-020.

**Task:** Implement opt-in policies, four-hour delay, approved cancellation, audited transitions, device alerts, and injectable SMTP. Provision a replacement user device without standing admin access or early usable key material.

**Acceptance:** Verify races, policy/admin changes, clock changes, notification failure, and unauthorized envelope access. Document the corrupted-history recovery path.

## Batch 12 — backup, migration, and container hardening

**Status/model:** After Batch 7 schema settles. `gpt-5.6-sol` low.

**Backlog IDs:** BAK-001–BAK-005, DEP-009–DEP-016, REL-009, TEST-011, TEST-014, TEST-015.

**Task:** Implement compressed application-authenticated PostgreSQL backups, verified clean restore, pre-migration backup gates, separate roles, serialized migrations, refusal of destructive automatic upgrades, and non-root/read-only OCI.

**Acceptance/exclusions:** Prove restore with disposable data without printing secrets. Use local storage first; defer S3/Azure adapters.

## Batch 13 — browser extension

**Status/model:** After stable web/auth/sync. `gpt-5.6-sol` low.

**Backlog IDs:** DEV-015, ITEM-011, REL-007.

**Task:** Implement a read-only extension connector for web, desktop and CLI. Use a native bridge to active desktop/CLI sessions or their verified encrypted local replicas for offline fill; use the unlocked web tab only as an online source. Never expose create/edit/delete/conflict-resolution or queued-write paths. Use independent v1 lock when shared native unlock is unavailable. Minimize permissions and content-script exposure; require explicit user-selected fill.

**Acceptance/exclusions:** Stop the server and close the web tab, then unlock and fill from an installed desktop/CLI encrypted replica. Verify active-client handoff, signed state, stale/rollback handling, restart and lock; observe no extension write requests. Keep secrets out of logs, URLs, persistent plaintext storage, and unnecessary messages. A filled destination input is visible to its page. Document phishing, frames, origins, clipboard, lifecycle, and malicious-page boundaries. Defer passkeys.

## Batch 14 — Windows drag-to-fill spike

**Status/model:** After Batch 7 APIs settle. `gpt-5.6-sol` low.

**Backlog IDs:** ITEM-011, ITEM-012.

**Task:** Build a bounded Tauri/WebView2 Windows 11 OLE spike dragging one fictitious username/password into a compatible external input.

**Acceptance/exclusions:** Verify cancellation, target rejection, lock-during-drag, clipboard independence, no logging, and native-buffer cleanup. No elevation or production claim. Record supported targets and go/no-go.

## Batch 15 — release and commercial scaffolding

**Status/model:** Deferred until core beta works. `gpt-5.6-sol` low.

**Backlog IDs:** LIC-001–LIC-009, DEP-003, DEP-006, DEP-007, REL-010–REL-012.

**Task:** Add approved experimental warnings, provenance hooks, license-state interfaces, 30-day read-only transition, and nondestructive lock.

**Acceptance/exclusions:** Do not add final `LICENSE` before public beta, invent checkout, delete data, or enforce lockout before emergency export is defined. Keep pricing non-contractual and list legal-review blockers.

## Batch 16 — pre-beta security gate

**Status/model:** Post-MVP security review. `gpt-6-astra` low; increase only for a specifically identified exceptional issue.

**Depends on:** All in-scope MVP implementation batches.

**Backlog IDs:** CRY-003, REL-002, REL-005–REL-013, TEST-001–TEST-016.

**Task:** Review implementation against ADRs, threat model, formats, key lifecycle, enrollment, auth, authorization, sync, recovery, deletion, backups, extension, deployment, update provenance, and licensing. Trace every server field as public metadata or ciphertext; run approved adversarial scenarios.

**Acceptance/exclusions:** Report severities and reproductions, unresolved design questions, external-review brief, and every blocker to real-password use. Do not silently fix ambiguity or claim production readiness.

## Parallelism rules

- Run one security-path batch (5A, 5B, 7–10, or 11B) at a time.
- Parallel Sol-low work must have recorded disjoint paths.
- Batch 12 may overlap UI-only work after schema freeze; Batch 14 may overlap server-only work after client-interface freeze.
- Centrally review each security-sensitive batch before dispatching dependents.

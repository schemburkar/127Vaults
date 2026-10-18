# Implementation backlog

> Historical architecture inventory. The live component backlogs and active waves are indexed in [product work](README.md). This document's checkboxes and handoff text reflect earlier planning and must not be used as current status. Retain its detailed outcomes as source material when scheduling a component wave.

This is the pre-implementation review list. Each checkbox is one independently
reviewable outcome; completion requires verification and documentation proportionate
to its risk. Unit tests are deferred at the user's request during initial
implementation; record them below. Manual smoke checks do not satisfy public-beta
security test gates.

## Item IDs

Each canonical outcome has a stable domain-prefixed ID. IDs identify outcomes, not
their execution order. `TEST` items preserve distinct verification work; batch
prompts and model routing remain in [implementation-batches.md](implementation-batches.md).

## First-slice increments

Work in [executable implementation batches](implementation-batches.md). Batch 2,
Batches 3A–3C1–3C, and the disposable encrypted-item flow in Batch 4 are verified.
Batch 5A is complete. Batch 5T is next and gates 5B. Do not add interface
placeholders in place of completing a batch.

Task prompts and model assignments are maintained in
[executable implementation batches](implementation-batches.md):

- Foundation/helper cleanup: Batch 1, `gpt-5.6-sol` low.
- Rust/WASM fixture: Batch 2, complete.
- Crypto evidence, format, dependency/toolchain selection, and implementation:
  Batches 3A–3C1–3C.
- Encrypted item UI: Batch 4.
- OPAQUE and onboarding: Batches 5A–6.
- Private vault, sync, conflicts, and devices: Batches 7–9.
- Sharing, retention, and recovery: Batches 10–11B.
- Backup and deployment hardening: Batch 12.
- Extension and Windows drag-to-fill: Batches 13–14.
- Release scaffolding and final security gate: Batches 15–16.

Do not check a backlog item merely because it was assigned to a batch.

- [x] IMP-001 — Verify one-command Podman setup/status/stop/restart on the existing Windows installation while preserving credentials and database identity.

- [x] IMP-002 — Add Rust secret-buffer/handle ownership feasibility with redacted diagnostics, lock invalidation, bounded entry count and no supported crypto formats; verify native smoke execution and WASM library compilation.
- [x] IMP-003 — Add strict type-checked draft TS ports and a component ownership/handoff map for concurrent human/agent work; distinguish planned signatures from implemented behavior.
- [x] IMP-004 — Add a fixture-only WASM binding and execute create/lock/stale-handle rejection in a browser; verify missing-WASM failure without exporting a secret-reader method.
- [ ] IMP-005 — Have implementers claim workstreams in [the interface map](../architecture/implementation-interfaces.md); review draft contract changes before wiring adapters.

- [x] IMP-006 — Implement and smoke-check a client-only login-item model with bounded fields, exact secret preservation, and a title/domain-only index projection; no encryption/persistence yet.
- [x] IMP-007 — Implement and smoke-check a one-item in-memory session component with fixed 30-minute idle expiry, access-time deadline checks, manual lock, and disposal; no browser/key integration yet.
- [ ] IMP-008 — Connect the session component to reviewed unlock, Rust key destruction, UI cleanup, and client lifecycle events; verify browser suspension and installed-client OS lock.

- [x] IMP-009 — Accept fixed loopback Host aliases for explicit container loopback publication; verify localhost access while rejecting foreign hosts and mismatched origins.
- [x] IMP-010 — Add and verify a Compose server liveness health check without exposing readiness credentials.
- [x] IMP-011 — Report provisional bootstrap guidance and invitation counts through local provisioning status; verify empty and owner-staged status.
- [x] IMP-012 — Preserve split-chunk UTF-8 provisioning input and reject malformed encoding; verify with byte-by-byte Unicode input.

- [x] IMP-013 — Replace the server placeholder with an explicitly enabled experimental HTTP listener; verify local liveness, readiness authorization/failure, Host/Origin/forwarded-header rejection, and wildcard/public bind refusal.
- [x] IMP-014 — Verify the OCI server and PostgreSQL Compose deployment, database readiness, persistence across database restart, and idle graceful shutdown on Podman.
- [x] IMP-015 — Add transactional empty-database schema initialization with version/checksum validation and refusal of non-empty or changed schemas; verify against PostgreSQL.
- [x] IMP-016 — Stage a provisional owner and ordinary invited-user records through a local operator command; verify concurrent bootstrap, identity uniqueness, pending-only state, expiry selection, and owner-mutation refusal.

### Deferred automated tests

- [ ] TEST-001 — Browser fixture regressions: actual WASM initialization/failure, idle hook, page lifecycle, bfcache reload, cross-instance isolation, repeated-create memory use, and checks in additional browser engines.
- [ ] TEST-002 — Audit/upgrade the experimental wasm-bindgen toolchain and its transitive dependencies before release use; review JS access to WASM memory before any real-secret claims.
- [x] TEST-003 — Resolve and review the exact minimal ECF1 native/WASM dependency graphs before implementation.

- [ ] TEST-004 — Development helper: fresh .env generation, malformed/duplicate settings, missing Podman/provider, stopped VM startup, first-machine initialization, build failure, timeouts, schema refusal, safe output redaction, and repeated start/stop persistence.
- [x] TEST-005 — Development helper isolated failure fixtures: malformed/duplicate settings preserve `.env`, missing Podman/provider diagnostics are actionable, timeouts are explicit and bounded, and synthetic credentials/database URLs are redacted.

- [ ] TEST-006 — Rust secret-store regression: capacity/handle exhaustion, stale/foreign handles, lock/drop ownership, redacted output and WASM-instance separation; add crypto vectors only once reviewed primitives/formats land.
- [ ] TEST-007 — TS contract conformance for concrete adapters, runtime validation of branded transport values, and negative checks for plaintext crossing server boundaries.

- [ ] TEST-008 — Login model: field limits, malformed Unicode, sparse collections, unexpected properties, URL policies, exact password bytes, immutable copies, and index secret exclusion.
- [ ] TEST-009 — Client session: access at expiry, delayed/throttled timers, clock changes, repeated unlock, failed item opening, UI reference cleanup, lifecycle hooks, and disposed-session behavior.


- [ ] TEST-010 — Account/schema regression: initialization races, non-empty/unknown schema refusal, rollback on failure, concurrent bootstrap, username/email collisions, invalid/oversized JSON, tenant foreign keys, role mutation, pending-only state, and invitation race, expiry, replay, cancellation, and cleanup.
- [ ] TEST-011 — Schema-aware readiness on missing/version-mismatched/checksum-mismatched databases; least-privilege runtime/provisioning role separation, credential rotation, upgrade compatibility, and migration-lock contention/timeouts.

- [ ] TEST-012 — Server configuration: experimental gate, invalid ports, IPv4/IPv6, private-address validation, wildcard/public refusal.
- [ ] TEST-013 — HTTP boundary: duplicate/malformed Host and Origin, forwarded headers, WebSocket refusal, methods, timeouts, readiness token rejection, detail-free errors.
- [ ] TEST-014 — PostgreSQL integration: outage/reconnect, pool failure, readiness success, termination with requests in flight, persistent-volume restart.
- [ ] TEST-015 — Deployment: Podman and Docker builds, loopback-only publication, no database host port, non-root/read-only server, subnet collision handling, and graceful shutdown with requests in flight.
- [ ] TEST-016 — Add account/migration, Rust crypto vectors, item sync and browser lock tests as those increments land; all adversarial and release tests below remain required before beta.

Verification evidence and run instructions: [experimental development](../release/experimental-development.md).

## Foundation and deployment

- [ ] DEP-001 — Keep server, web, extension, desktop, CLI, TypeScript packages, and Rust crates in one monorepo.
- [ ] DEP-002 — Pin supported Node.js, pnpm, Rust, PostgreSQL, and container image versions.
- [ ] DEP-003 — Pin release dependencies exactly in lockfiles and release container inputs by immutable digest.
- [ ] DEP-004 — Add formatting, linting, type-checking, clippy, tests, dependency auditing, and secret scanning.
- [ ] DEP-005 — Version protocol, cryptographic format, database schema, and client compatibility independently.
- [ ] DEP-006 — Mark all builds experimental until the public-beta security gates are satisfied.
- [ ] DEP-007 — Keep the repository local without a remote until Shubhan Chemburkar chooses to publish.
- [ ] DEP-008 — Build the TypeScript server as an OCI container.
- [ ] DEP-009 — Provide one Compose-compatible deployment for Podman and Docker Engine.
- [ ] DEP-010 — Run PostgreSQL separately with a persistent volume and private container network.
- [ ] DEP-011 — Keep PostgreSQL as the only supported server database.
- [ ] DEP-012 — Add health, readiness, migration, and safe-shutdown behavior.
- [ ] DEP-013 — Run compatible migrations under a database lock after creating and verifying a pre-migration backup.
- [ ] DEP-014 — Refuse automatic destructive or incompatible migrations and provide an explicit admin procedure.
- [ ] DEP-015 — Expose detail-free unauthenticated liveness and authenticated readiness diagnostics.
- [ ] DEP-016 — Run production containers non-root with a read-only root filesystem and minimal writable mounts.
- [ ] DEP-017 — Default the listener to loopback and allow only explicit private LAN, Tailscale, or approved private Cloudflare bindings.
- [ ] DEP-018 — Reject wildcard public binding, arbitrary domains, and unapproved Host, SNI, Origin, WebSocket, and WebAuthn identities.
- [ ] DEP-019 — Model one logical write authority per self-hosted installation.
- [ ] DEP-020 — Reserve multiple stateless instances for hosted cloud while keeping one transactional writer per tenant in v1.
- [ ] DEP-021 — Keep active-active multi-region writes outside v1.

## Ownership, users, and invitations

- [ ] IAM-001 — Bootstrap the first account as server owner and require at least one owner forever.
- [ ] IAM-002 — Allow multiple owners and require a prospective owner to accept ownership.
- [ ] IAM-003 — Prevent admins from adding, removing, or demoting owners.
- [ ] IAM-004 — Keep server user, admin, and owner roles separate from vault cryptographic access.
- [ ] IAM-005 — Make post-bootstrap account creation invite-only.
- [ ] IAM-006 — Generate high-entropy grouped, checksummed, QR-capable invitation codes.
- [ ] IAM-007 — Bind invitations to an exact email list, redemption count, and admin-selected 24-hour or 48-hour expiry.
- [ ] IAM-008 — Deliver invitations outside 127Vaults and verify the claimed email before account creation.
- [ ] IAM-009 — Create invited accounts as ordinary users and assign elevated roles separately.
- [ ] IAM-010 — Enforce unique case-insensitive ASCII usernames of 5–64 allowed characters while preserving casing.
- [ ] IAM-011 — Permit Unicode display names independently of usernames.

## Credentials and authentication

- [ ] AUTH-001 — Generate an independent high-entropy printable and QR account secret for every user.
- [ ] AUTH-002 — Require account secret and master password for new-device enrollment.
- [ ] AUTH-003 — Enforce a 20-grapheme-cluster master-password minimum with exact UTF-8 and no composition rules.
- [ ] AUTH-004 — Check new passwords through padded HIBP k-anonymity by default without sending full passwords or hashes.
- [ ] AUTH-005 — Allow HIBP disablement and warn-but-continue when an enabled check is unavailable.
- [ ] AUTH-006 — Start exponential authentication delay after five failures with a server-authored one-hour maximum retry-after.
- [ ] AUTH-007 — Require server-admin authentication unlock after 20 consecutive account-wide failures.
- [ ] AUTH-008 — Ensure admin unlock neither resets credentials nor decrypts vaults.
- [ ] AUTH-009 — Tell locked users to contact an administrator outside 127Vaults.
- [ ] AUTH-010 — Add optional account TOTP with verification, separate-authenticator warning, and recovery codes.
- [ ] AUTH-011 — Route lost-TOTP recovery through the selected-admin four-hour recovery ceremony.

## Cryptographic core

- [ ] CRY-001 — Implement cryptographic operations in a narrow Rust core with native and WASM bindings; document disposal and migration before changing an experimental format.
- [ ] CRY-002 — Expose crypto to TypeScript through versioned non-secret-bearing interfaces.
- [ ] CRY-003 — Freeze reviewed algorithms, parameters, encodings, associated data, and test vectors before public beta.
- [ ] CRY-004 — Prove the server never receives the master password through an audited augmented PAKE or equivalent reviewed protocol.
- [ ] CRY-005 — Spike RFC-aligned OPAQUE Rust/WASM maturity, interoperability, audit coverage, and account-secret composition.
- [ ] CRY-006 — Domain-separate the master-password/account-secret OPAQUE input from every root-key-wrapping input.
- [ ] CRY-007 — Derive password protection using a reviewed memory-hard KDF.
- [ ] CRY-008 — Combine password-derived protection and account secret without exposing either to the server.
- [ ] CRY-009 — Generate and wrap a random user root key rather than deriving vault keys directly.
- [ ] CRY-010 — Generate a distinct random key and key epoch for every vault.
- [ ] CRY-011 — Bind ciphertext to tenant, user, vault, object, field, schema version, and key epoch where applicable.
- [ ] CRY-012 — Make nonce reuse structurally difficult and authenticate every device-originated operation.
- [ ] CRY-013 — Keep master passwords, account secrets, private device keys, vault keys, and plaintext items off the server.
- [ ] CRY-014 — Make password changes rewrap the root key without item re-encryption or device reapproval.
- [ ] CRY-015 — Make account-secret changes require a new password, online epoch change, session revocation, and device reenrollment.

## Devices, locking, and local storage

- [ ] DEV-001 — Give every enrolled device an independent identity approved by a trusted device.
- [ ] DEV-002 — Bind trusted-device enrollment to a short-lived entered code or scanned QR payload.
- [ ] DEV-003 — Define separate first-device and lost-last-device enrollment ceremonies.
- [ ] DEV-004 — Use provable hardware-backed non-exportable keys on supported platforms.
- [ ] DEV-005 — Target Windows 11 TPM/CNG, Android hardware Keystore attestation, Apple Secure Enclave/Keychain, and Linux TPM 2.0.
- [ ] DEV-006 — Require account secret and master password on every Linux launch when hardware-backed storage is unavailable.
- [ ] DEV-007 — Defer software-backed persistent Linux device keys.
- [ ] DEV-008 — Store a complete encrypted local replica of accessible vaults on offline-capable clients.
- [ ] DEV-009 — Keep the server-hosted web client online-only.
- [ ] DEV-010 — Drop decrypted items and usable vault keys from memory on lock and document zeroization limitations.
- [ ] DEV-011 — Lock installed clients on exit, OS device lock, or 30 minutes of inactivity.
- [ ] DEV-012 — Unlock once per session without reprompting for reveal, copy, or edit.
- [ ] DEV-013 — Clear copied passwords and TOTP codes after 30 seconds on a best-effort basis.
- [ ] DEV-014 — Defer screenshot and recording protection to v2.
- [ ] DEV-015 — Prefer shared desktop-extension lock state while allowing independent extension locking in v1.
- [ ] DEV-016 — Add biometric quick unlock only after platform policies can enforce the approved biometric-only behavior.

## Vaults, items, and clients

- [ ] ITEM-001 — Support multiple users, private vaults, and shared vaults in every persistent schema.
- [ ] ITEM-002 — Implement login items with title, username, password, URLs, and custom fields first.
- [ ] ITEM-003 — Decrypt only the lightweight title and domain index until an item is opened.
- [ ] ITEM-004 — Decrypt web item bodies one at a time.
- [ ] ITEM-005 — Add TOTP fields after the initial login-item slice.
- [ ] ITEM-006 — Add passkeys only after a dedicated WebAuthn security design.
- [ ] ITEM-007 — Add generated security-question fields with warnings against truthful answers.
- [ ] ITEM-008 — Add secure notes after security questions.
- [ ] ITEM-009 — Keep attachments outside core and later expose a pluggable storage add-on.
- [ ] ITEM-010 — Keep a persistent trusted-server warning on the server-delivered web client.
- [ ] ITEM-011 — Build web, browser extension, Windows desktop, and CLI in that order.
- [ ] ITEM-012 — Spike Windows Tauri/WebView2 native OLE drag-to-fill into compatible inputs.
- [ ] ITEM-013 — Design future mobile clients as offline-first.

## Sharing and authorization

- [ ] SHARE-001 — Restrict sharing to users on the same server.
- [ ] SHARE-002 — Give all shared-vault members read and grant write explicitly.
- [ ] SHARE-003 — Make manager include read, write, and member administration while keeping owner distinct.
- [ ] SHARE-004 — Prevent managers from removing or replacing the owner and require accepted ownership transfer.
- [ ] SHARE-005 — Restrict vault deletion initiation to the owner.
- [ ] SHARE-006 — Grant server admins vault access only through explicit policy plus cryptographic keys.
- [ ] SHARE-007 — Rotate the vault epoch on member removal and distribute it only to remaining members.
- [ ] SHARE-008 — Reject queued writes from removed members and revoked devices.
- [ ] SHARE-009 — State that previously decrypted or copied data cannot be recalled.

## Sync and conflicts

- [ ] SYNC-001 — Implement an authenticated encrypted operation log with stable IDs and idempotent submission.
- [ ] SYNC-002 — Use causal base revisions and server ordering rather than clocks for conflict decisions.
- [ ] SYNC-003 — Keep timestamps as display and audit metadata only.
- [ ] SYNC-004 — Merge concurrent changes to different fields automatically.
- [ ] SYNC-005 — Preserve same-field candidates for explicit A, B, or both resolution by any writer.
- [ ] SYNC-006 — Suffix a duplicated both-resolution item with `Copy`.
- [ ] SYNC-007 — Allow unresolved field conflicts indefinitely with a badge and highlighted sidebar.
- [ ] SYNC-008 — Keep unrelated fields usable but require resolution before editing the conflicted field.
- [ ] SYNC-009 — Model concurrent delete/edit as a tombstone conflict that blocks all item edits until resolved.
- [ ] SYNC-010 — Allow keep-original, keep-edit, both, or delete when resolving a delete conflict.
- [ ] SYNC-011 — Allow incremental cursor synchronization for 30 days.
- [ ] SYNC-012 — Verify a fresh encrypted snapshot after cursor expiry and rebase pending operations.
- [ ] SYNC-013 — Use sockets only for change notifications and authenticated HTTPS for all sync data.
- [ ] SYNC-014 — Add polling fallback and bounded reconnect backoff.
- [ ] SYNC-015 — Sign operations and chain checkpoints for replay, rollback, omission, and reorder detection.
- [ ] SYNC-016 — Stop affected-vault sync on unverifiable history while retaining verified offline reads and evidence.
- [ ] SYNC-017 — Implement retry, checkpoint comparison, verified snapshot/backup restore, explicit signed repair, and local-export recovery stages.
- [ ] SYNC-018 — Require owner approval and four-hour member notice before shared-vault history replacement.
- [ ] SYNC-019 — Freeze on divergent valid checkpoints and require explicit owner branch review without timestamp selection.
- [ ] SYNC-020 — Restrict private-vault repair to the user or the enabled four-hour recovery ceremony.
- [ ] SYNC-021 — Exclude ciphertext from diagnostics unless the user explicitly gives informed consent.
- [ ] SYNC-022 — Retain local checkpoints for rollback detection.
- [ ] SYNC-023 — Defer an optional transparency notary to v2 and never require a hosted integrity service.
- [ ] SYNC-024 — Specify safe rebase and reencryption for an authorized device behind a key rotation.

## Recovery, notification, and revocation

- [ ] REC-001 — Make private-vault admin recovery opt-in per vault.
- [ ] REC-002 — Let a user choose any admin, one admin, or any one from a selected admin set.
- [ ] REC-003 — Require one eligible admin and enforce a four-hour pending recovery delay.
- [ ] REC-004 — Prevent admin access to a usable vault key before recovery completes.
- [ ] REC-005 — Notify registered devices and email when recovery begins.
- [ ] REC-006 — Allow recovery to complete when email delivery cannot be verified.
- [ ] REC-007 — Provision a replacement user device without granting the admin standing plaintext access.
- [ ] REC-008 — Send alerts through BYO SMTP or an optional fixed-template metadata-minimized hosted relay.
- [ ] REC-009 — Stop revoked devices from authenticating or synchronizing.
- [ ] REC-010 — Keep remote wipe opt-in, off by default, signed, best effort, and honest about its limitations.
- [ ] REC-011 — Offer an optional server reconnect reminder that never locks an offline vault.

## Deletion and history

- [ ] RET-001 — Keep deleted items in recoverable trash for 10 days.
- [ ] RET-002 — Let writers view and restore item history.
- [ ] RET-003 — Give shared-vault deletion a notified four-hour read-only pending state.
- [ ] RET-004 — Give all deleted vaults a 24-hour recoverable state before purge.
- [ ] RET-005 — Allow only owner or server admin to cancel or restore vault deletion.
- [ ] RET-006 — Keep server-admin restoration control-plane-only without content keys.
- [ ] RET-007 — Retain metadata events for 90 days by default with a 365-day maximum.
- [ ] RET-008 — Retain encrypted value snapshots for at most 120 days.
- [ ] RET-009 — Retain the last 10 distinct passwords until item or vault purge.
- [ ] RET-010 — Retain created and last-edited timestamps throughout item lifetime.

## Backups

- [ ] BAK-001 — Create consistent compressed PostgreSQL backups with application-level authenticated encryption.
- [ ] BAK-002 — Support BYO S3-compatible and Azure storage.
- [ ] BAK-003 — Offer convenience server-managed restore and offline-private-key restore modes.
- [ ] BAK-004 — Treat provider SSE/KMS as defense in depth only.
- [ ] BAK-005 — Prove restore into a clean deployment before calling backups supported.

## Licensing and commercial behavior

- [ ] LIC-001 — Keep private local work unlicensed until publication.
- [ ] LIC-002 — At public beta adopt reviewed source-available terms with Shubhan Chemburkar as licensor.
- [ ] LIC-003 — Finalize any version-specific AGPL-3.0-only conversion commitment before publication.
- [ ] LIC-004 — Offer alternate paid Personal and Commercial terms from public beta.
- [ ] LIC-005 — Obtain legal review before publication.
- [ ] LIC-006 — Publish a fresh one-commit licensed tip while retaining private history locally.
- [ ] LIC-007 — Implement planned Personal, Commercial, Cloud, and hosted-SMTP pricing only when those products exist.
- [ ] LIC-008 — Provide 30 days read-only after expiry and then lock access without deleting data.
- [ ] LIC-009 — Define a bounded emergency export path before enforcing license lockout.

## Initial slice and release gates

- [ ] REL-001 — Use a fixture of 10 users, two devices each, five vaults, 50 items, and 100 operations without making these hard limits.
- [ ] REL-002 — Test at least 10 users and 5,000 items before public beta.
- [ ] REL-003 — Prove one browser profile can create, encrypt, persist, lock, unlock, and sync one login item.
- [ ] REL-004 — Add second-device enrollment and conflicts immediately after the one-profile slice.
- [ ] REL-005 — Freeze crypto formats and publish deterministic test vectors.
- [ ] REL-006 — Complete adversarial enrollment, recovery, revocation, sync, epoch, and history tests.
- [ ] REL-007 — Complete extension isolation, autofill, phishing, and malicious-page analysis.
- [ ] REL-008 — Complete passkey/WebAuthn analysis before enabling passkeys.
- [ ] REL-009 — Test migrations, upgrades, backup, restore, and rollback.
- [ ] REL-010 — Sign releases and define secure update provenance.
- [ ] REL-011 — Run dependency, vulnerability, license, and secret scans.
- [ ] REL-012 — Publish operations documentation and experimental warnings.
- [ ] REL-013 — Obtain independent crypto and application review before production-security claims.

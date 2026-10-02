# Private alpha batches

## Current MVP checkpoint (2026-09-12)

- Implemented: retained PostgreSQL persistence; schema v2; hardened containers;
  web owner/unlock/vault/item journey; navigable vault workspace; device list and
  web-approved CLI enrollment.
- Implemented: CLI CA/server trust, OS-protected per-device Ed25519 key, no-echo
  secrets, native OPAQUE unlock, vault list/create, and item list/get/create/edit.
- Implemented: item ciphertext mutation and signed-sync append share one database
  transaction. Web and CLI sign the same versioned operation format.
- Verification: JavaScript tests pass; Rust workspace tests and strict clippy pass.
  A human web-to-CLI-to-web run remains because it requires the owner's secrets.
- Deferred: automated interoperability, productized backup/restore, recovery UI,
  checkpoint consumption/conflict UX, and public-beta release gates.

### Remaining internal-MVP gate

Run [the CLI interoperability procedure](cli-mvp.md), record any failure stage,
and fix it before automating that same journey.

## UX prototype and adoption

Build a separate, hardcoded clickable prototype covering unlock, vault navigation,
search, item viewing/editing, copy/reveal feedback, empty states, locking, and basic
settings. Use fictitious values only and no backend, persistence, or cryptographic
claims. Review the journey and visual language first; then port only approved design
and interaction patterns into the real web client with browser tests.

## Isolated real-data readiness

Do not remove the fictitious-data warning until cryptographic formats and vectors
are frozen and reviewed; device enrollment/revocation/recovery and signed sync are
complete; migrations, file-backed secrets, hardened pinned containers, encrypted
backup and clean restore are tested; supported browsers and container engines pass;
and security, dependency, artifact, licensing, and operator-runbook gates are closed.
The first private beta runs on a dedicated host or VM over loopback, private LAN, or
Tailscale only, with no public DNS/port forwarding and with off-host restore-tested
backups.

### Accepted private-beta scope

- Same host is allowed initially; a dedicated machine is not required.
- Serve only on loopback, an explicitly selected private-LAN address, or Tailscale.
- Reject public DNS, public forwarding, wildcard binds, and arbitrary proxy headers.
- Keep PostgreSQL on its private container network and persistent named volume.
- Cloud backup adapters and public hosting remain outside this track.

### Ordered implementation track

1. **RB1 — crypto freeze candidate:** assign independent format/protocol versions,
   pin exact dependencies, publish deterministic native/WASM vectors, and fail
   closed on unknown versions. This remains review-candidate status.
2. **RB2 — signed sync integrity:** canonical signed operations, causal bases,
   checkpoints, idempotency, replay/rollback/fork detection, and verified snapshots.
3. **RB3 — device lifecycle:** trusted-device code/QR enrollment, independent device
   keys, revocation, credential rotation, session epochs, and documented lost-device
   recovery without standing admin plaintext access.
4. **RB4 — hardened containers:** immutable image inputs, minimal non-root runtime,
   read-only server/PostgreSQL roots, explicit writable mounts, resource limits,
   file-backed secrets, and Docker/Podman checks.
5. **RB5 — operations:** migrations with a verified pre-migration backup, encrypted
   backup and clean restore, certificate renewal, upgrades/rollback, emergency
   access, and an operator runbook tested on a fresh isolated installation.
6. **RB6 — official CLI:** build a first-party Rust client against the same
   versioned authentication, device, sync, and vault contracts as web. Support
   server trust onboarding, unlock, vault/item list/get/create/update, explicit
   lock/logout, and machine-readable output that never emits secrets by default.
   Store no plaintext and require an enrolled device identity; add export only
   after emergency-export policy is approved.

RB1 precedes RB2/RB3. RB4 can proceed alongside RB1 on disjoint files. RB5 requires
the final schema from RB2/RB3 and a working backup/restore implementation. RB6 may
scaffold early, but protocol integration starts after RB1 and exercises RB2/RB3
before either is considered complete.

Internal notes: 
1. UX-polished private alpha
Keep using fictitious data while we improve:
- Desktop-first, 1Password-style layout: vault sidebar, item list, item editor.
- Hide first-owner setup after installation.
- Remove fictitious default field values.
- Clear empty states and actionable errors.
- New/edit/cancel states with unsaved-change protection.
- Password reveal and copy actions; clear clipboard after 30 seconds.
- Better lock state and inactivity feedback.
- Search by decrypted title/domain only.
- Responsive layout and keyboard accessibility.
- A diagnostics panel that exposes safe error IDs—not secrets or ciphertext.
This should be the next implementation batch.
2. Isolated real-data private beta
Before storing real credentials, we need at minimum:
1. Freeze and version the cryptographic format, dependencies, parameters, and test vectors.
2. Complete the post-MVP security review and resolve every critical/high finding.
3. Implement tested migrations plus encrypted backup and clean-machine restore.
4. Replace environment secrets with file-mounted container secrets.
5. Harden the server and PostgreSQL containers: read-only roots, non-root users, limits, pinned images, minimal runtime.
6. Add device enrollment, revocation, credential rotation, and lost-device recovery.
7. Implement signed sync/checkpoints and rollback/replay detection.
8. Add dependency, vulnerability, secret, and artifact scans.
9. Test supported browsers and both Podman/Docker deployment paths.
10. Produce an operator runbook covering installation, upgrades, backup, restore, certificate renewal, and emergency access.
The first real-data installation should then run on a dedicated machine or VM:
- LAN/loopback only, or Tailscale private access.
- No public port forwarding or public DNS.
- Separate PostgreSQL volume.
- Encrypted backups stored outside the host.
- Restore tested into a second isolated instance.
- Only non-critical duplicate credentials initially—not the sole copy of important accounts.

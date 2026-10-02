# MVP plan

> Historical scope decision from 2026-09-08. For current implementation state use the [component backlogs](README.md) and [beta readiness](../release/beta-readiness.md).

Planning checkpoint: 2026-09-08. Implementation resumes in a later session.
This delivery cut was accepted on 2026-09-08; it preserves the wider backlog.

## Delivery levels

| Level | Outcome | Data |
| --- | --- | --- |
| Demo | Disposable Rust/WASM encryption and login-item flow; no usable account required | Fictitious only |
| Internal MVP | Authenticated online web account, private vault, encrypted online persistence/fetch | Fictitious only until release gates pass |
| Public beta | Supported release with reviewed security, recovery, operations and licensing | Real secrets only after the beta gates pass |

## Current evidence

- Batch 1: existing Windows/Podman development setup verified; clean-machine and Docker coverage remain incomplete.
- Batch 2: real Rust/WASM fixture and lock/handle behavior verified; no encryption or authentication.
- Batch 3A: candidate dependency evidence reviewed; no runtime crypto delivered.
- Batch 3B: disposable ECF1 format accepted; no stable format approved.
- Batch 3C0: exact dependency selection accepted; integration and matched WASM toolchain upgrade remain pending.
- Provisional accounts and isolated item/session components exist; they are not a usable product.

Evidence: [batches](implementation-batches.md), [development](../release/experimental-development.md),
[WASM fixture](../release/rust-browser-fixture.md), [ECF1](../security/experimental-crypto-format.md),
[dependency selection](../security/ecf1-dependency-selection.md).

## Accepted internal MVP scope

- One self-hosted authority, OCI/Compose server and separate PostgreSQL container.
- Online-only web client with a persistent trusted-server notice.
- First owner, one invited user, independent account secrets and reviewed authentication.
- One private vault per test account; login title, username, password, URLs and custom fields.
- Client encryption, authorized create/list/read/update, item-at-a-time decryption and 30-minute lock.
- One browser profile for the first end-to-end acceptance; account isolation checked separately.
- Schemas preserve multiple users/vaults, device identities and future sharing boundaries.
- Bootstrap, browser identity, private HTTPS, item pairing and SMTP email proof follow the [accepted decisions](mvp-open-decisions.md).

Outside this cut: sharing, selected-admin recovery, account MFA, stored TOTP,
passkeys, history/trash, imports, attachments, extension/native/mobile/CLI clients,
cloud hosting, S3/Azure integration and license enforcement. These remain planned.
Delete follows trash/history; signed multi-device sync, second-device enrollment and conflicts follow the one-profile slice. They are
required before the broader beta can claim those capabilities.

## Planning gates

1. Internal MVP scope accepted; public-beta scope remains a separate release gate.
2. Complete OPAQUE dependency probes and vectors before usable authentication (5A/Q-001).
3. Implement and verify private HTTPS before LAN authentication acceptance (5T).
4. Specify signed operations, checkpoints, snapshot validation and repair before sync integrity work.
5. Specify credential rotation, lost-device recovery and admin-recovery trust assumptions before their implementation.
6. Set beta feature scope and close its operational, test and licensing gates before publication.

Detailed policy stays in [ADRs](../adr/README.md),
[key hierarchy](../security/key-hierarchy.md), [sync protocol](../sync/protocol.md)
and [questions](questions.md). A later feature's unfinished design need not block
an independent disposable demo.

## Implementation sequence

| Milestone | Batches | Acceptance |
| --- | --- | --- |
| Disposable encryption | Toolchain upgrade, 3C | Native/browser round trips; tamper, context, limits and entropy failures rejected |
| Disposable item demo | 4 | Fictitious item encrypts, reloads and clears on lock |
| Authentication and onboarding | 5A, 5T, 5B–6 | Private HTTPS and owner/invite ceremonies work; neither user secret reaches the server |
| Internal MVP | 7 | One profile creates, lists, reads, updates, persists, locks, unlocks and fetches its private item |
| Device and integrity expansion | 8A–9 | Signed sync, second-device approval, revocation, conflicts and verified snapshots |
| Household and operations expansion | 10–12 | Shared authorization, recovery/history and verified backup/restore |
| Additional clients and release | 13–16 | Approved client scope and all applicable beta gates verified |

Use the [batch prompts](implementation-batches.md) for task/model assignments and
the [backlog](implementation-backlog.md) for completion tracking. Dependency and
path ownership rules still apply; a milestone is not one agent assignment.

## Internal MVP acceptance

- Reproduce the online flow from a documented disposable container deployment.
- Complete real authentication and email/invite verification before activating accounts; fakes remain demo-only.
- Inspect requests, logs and PostgreSQL: no master password, account secret, usable content key or item plaintext.
- Reject wrong secrets, unauthorized account/vault access, malformed ciphertext and context substitution.
- Reject stale-base updates and divergent request-ID reuse; never expose a half-published item revision.
- Recover the same item after server/browser restart through authenticated fetch; make no offline-web claim.
- Clear rendered secrets and invalidate key handles on lock; document runtime cleanup limits.
- Record exact checks, failures and deferred automated coverage; preserve experimental format labels.

## Public-beta gates

The authoritative list is [beta readiness](../release/beta-readiness.md).

- Freeze reviewed formats and deterministic vectors; complete adversarial authentication, device, sync and recovery tests.
- Validate supported clients and enabled features, including autofill/passkeys before enabling them.
- Prove backup/restore, safe migrations, upgrades, container hardening and supported deployment paths.
- Test the 10-user/5,000-item household; set measured operation/performance thresholds.
- Complete release provenance, scanning, operating guidance and release-specific legal terms.
- Resolve emergency export before license lockout; obtain independent review before production-security claims.

Deferred unit tests and manual smoke evidence do not satisfy these release gates.

# Open decisions

Reviewed 2026-09-09. Accepted choices live in their canonical documents. IDs
remain stable. Resolved items stay listed below for traceability.

## MVP gates

No open decision currently blocks internal-MVP implementation.

| ID | Open decision / recommendation | Deadline | Canonical target |
| --- | --- | --- | --- |
| Q-001 | Resolved by Batch 5A for internal MVP; exact graph, RFC vectors, native/WASM probes and residual audit risk are recorded. | Complete | [OPAQUE evidence](../security/opaque-feasibility-evidence.md) |

## Resolved MVP specifications

| IDs | Resolution |
| --- | --- |
| Q-002–Q-003 | Session, CSRF, enumeration, backoff and host-local owner unlock are fixed in the [authentication protocol](../security/mvp-authentication-protocol.md). |
| Q-004–Q-005, Q-007 | Identity, secret kit, onboarding proofs, SMTP and private HTTPS are fixed in [onboarding and transport](../security/mvp-onboarding-transport.md). |
| Q-006 | Authenticated directory/manifest pairing, atomic writes and API bounds are fixed in the [private-vault contract](../architecture/private-vault-contract.md). |

## Implementation-time gates

Resolve during the affected batch review. Later features do not block the internal
MVP. [Batches](implementation-batches.md) own execution prompts and model routing.

| ID | Open decision / recommendation | Deadline | Canonical target |
| --- | --- | --- | --- |
| Q-008 | Freeze signed encodings, authorization history, checkpoints and snapshot completeness; reject ambiguous history rather than choose by time. | Before 8A/8B | [Sync](../sync/protocol.md) |
| Q-009 | Specify lost-device re-enrollment and rotation; distinguish offline decryption from server MFA and future revocation from old-key erasure. | Before Batch 9/MFA | [Enrollment](../adr/0003-device-enrollment-and-recovery.md), [credentials](../adr/0014-user-credentials-and-root-key-wrapping.md) |
| Q-010 | Specify epoch rebase, key acknowledgements, retirement and historical re-encryption; never delay future-key rotation for background work. | Before Batch 10 | [Sharing ADR](../adr/0010-shared-vault-roles-and-membership-epochs.md) |
| Q-011 | Define recovery key release, clock/collusion trust, policy changes and notification failure; do not claim a server timer cryptographically enforces four hours. | Before Batch 11B | [Recovery ADR](../adr/0003-device-enrollment-and-recovery.md) |
| Q-012 | Specify deletion races, signed timing and purge/backup interaction; preserve accepted owner/admin cancellation rules. | Before Batch 11A | [Retention ADR](../adr/0011-deletion-and-history-retention.md) |
| Q-013 | Specify backup retention, key rotation, interrupted uploads and restore drills; deliver S3 before Azure as already recorded. | Before Batch 12 | [Backup ADR](../adr/0006-backup-encryption-modes.md) |
| Q-014 | Choose socket library and reconnect limits; retain notifications-only sockets plus HTTPS fetch/polling. | Before Batch 8A | [Sync](../sync/protocol.md) |
| Q-015 | Enumerate administration permissions; default-deny actions outside accepted owner/admin boundaries. | Before role endpoints | [Roles ADR](../adr/0017-server-ownership-and-roles.md) |
| Q-016 | Select shared extension/desktop locking after the native-messaging spike; independent extension locking remains permitted for v1. | Before Batch 13 | [Locking ADR](../adr/0019-client-locking-and-secret-exposure.md) |

## Before public beta

| ID | Open decision / recommendation | Deadline | Canonical target |
| --- | --- | --- | --- |
| Q-017 | Select beta features/clients and measured scale thresholds; apply every enabled feature's release gates. | Before beta scope freeze | [Beta readiness](../release/beta-readiness.md) |
| Q-018 | Freeze production crypto libraries, parameters, formats and vectors after review; ECF1 approval is disposable only. | Before real-secret support | [Crypto ADR](../adr/0020-authentication-crypto-suite-and-object-identifiers.md) |
| Q-019 | Define bounded emergency export before license lockout; preserve encrypted data and keys. | Before license enforcement | [License-state ADR](../adr/0004-license-state-is-not-key-destruction.md) |
| Q-020 | Finalize legal terms, entitlements, support, limits and Personal upgrade rights; review release licensing and relay costs. | Before offering each paid product | [Pricing](pricing.md), [licensing](../adr/0013-release-licensing.md) |
| Q-021 | Choose any self-hosted telemetry and disclosures; recommend no collection by default. | Before public distribution | [Threat model](../security/threat-model.md) |
| Q-022 | Choose essential import formats; defer unsupported formats explicitly and validate imports before enabling them. | Before migration support | [MVP plan](mvp-plan.md) |

## Post-MVP choices

| ID | Open decision / recommendation | Deadline | Canonical target |
| --- | --- | --- | --- |
| Q-023 | Choose mobile/macOS release order and minimum Apple versions; validate hardware APIs before promising support. | Before platform implementation | [Device ADR](../adr/0009-device-key-protection-and-lifecycle.md) |
| Q-024 | Revisit Linux software-backed persistence after TPM feasibility; retain both credentials each launch meanwhile. | Before Linux persistence support | [Device ADR](../adr/0009-device-key-protection-and-lifecycle.md) |
| Q-025 | Decide SSH-key item support; retain the accepted login/TOTP/passkey/questions/notes order. | Before adding that type | [Item-scope ADR](../adr/0007-client-connectivity-and-item-scope.md) |
| Q-026 | Consider conflict-author highlighting; preserve any writer's ability to resolve without absent authors. | After v1 conflict flow | [Sync](../sync/protocol.md) |
| Q-027 | Review optional notary and cloud failover designs; never require a hosted notary for local unlock/sync. | Before enabling either | [Topology ADR](../adr/0018-offline-replicas-causal-sync-and-server-topology.md) |
| Q-028 | Specify attachment providers, quotas, chunks, garbage collection and backup consistency; keep core independent of the add-on. | Before attachment implementation | [Attachment ADR](../adr/0008-optional-attachment-service.md) |

No settled decisions require migration from this file: existing ADRs, the backlog,
pricing and the MVP plan retain their canonical scope. Deferred outcomes such as
biometrics and screenshot protection remain in the [backlog](implementation-backlog.md).

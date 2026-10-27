# Server hardening, 27 October 2026

Follow-up fixes also close three reproduced gaps:

- Protected write transactions revalidate and lock the account, credential,
  device and session rows before resource locks or receipt replay. Logout,
  suspension, expired sessions and epoch changes invalidate previously read
  authentication snapshots. The locks serialize revocation with commit.
- Rotation preparation requires the current device's signature before OPAQUE,
  binding the request, target device, origin, session, nonce and timestamp.
  Durable nonce consumption and a five-per-minute account budget prevent
  replay and repeated evaluations using only a stolen bearer session.
- The TLS relay adds bounded PROXY v1 connection metadata. The server accepts
  it only from the relay's fixed backend IP, then forwards unchanged TLS into
  its normal HTTPS listener. Admission budgets use that source, never HTTP
  forwarding headers. This trusts the private container network and host;
  upstream NAT can still merge addresses before they reach the relay.

The server and relay must be upgraded together using the installer workflow.
New installations reserve backend `.4` for the relay; upgrades derive it from
the existing server address while retaining the old bundle's configuration.
Direct connections use their actual socket address. No deployment is included.

This change addresses the seven items from the focused server review. It is a
source remediation and regression record, not an independent cryptographic
audit or a deployment/publication receipt.

| Review item | Remediation | Regression coverage |
| --- | --- | --- |
| Tenant-wide permanent vault-write ceiling | Account-scoped rolling budget, serialized admission and seven-day receipt retention | An account with 10,000 receipts cannot block another; fresh account limits and cross-account vault reads are checked |
| Victim enrollment slots occupied without credentials | Remove the per-account pending ceiling; use independent, durable source budgets and expiry cleanup | Five unsolicited requests cannot prevent a legitimate request; approval and completion still require their bound device proofs |
| Interrupted admin login escaping the async listener | Catch stream failures locally and contain the main request promise | Abort an actual loopback HTTP body, then serve another request; test sync and async outer failures |
| Existing-account OPAQUE evaluations through registration | Validate bootstrap/invitation authority, reject existing IDs and apply a durable source budget before OPAQUE | Invalid invitation and existing account requests never reach the OPAQUE operation |
| Abandoned KE2 guesses missing failure accounting | Reserve an attempt before returning KE2; reset only after complete device authentication; unknown devices receive fake credentials | Real OPAQUE challenge abandonment increments the durable counter; full authentication resets it |
| Broken credential rotation | Separate purpose-bound registration and signed replacement; use the actual credential table, fresh session and atomic invalidation | Real OPAQUE old/new password and account-secret checks; reject wrong-account/signing-key authorization and replay; update encrypted settings atomically |
| Account enumeration through changing fake UUIDs | Keyed deterministic synthetic account IDs and fake records for unknown/inactive devices; indistinguishable pending enrollment responses | Repeated missing-account and unknown-device requests have stable synthetic bindings; unknown enrollment requests retain the same public shape |

The revised server API contract is in `docs/architecture/api-v1-contract.md`.
The browser's initial-registration request and internal acceptance clients now
include registration authority. Credential rotation is a server API, not a new
browser settings screen. Its callers must preserve the existing root key when
rewrapping it, and reencrypt account settings for the next epoch. The tests use
disposable synthetic material; they do not certify client-side rewrapping UX.

Schema 10 adds durable request budgets and indexes. The existing schema command
supports a transactional 9-to-10 dry run and apply. The installer upgrade workflow
backs up and rehearses first, then advances schemas 8/9 to 10. Backup recognition
now includes schema 10. Existing installations must use that workflow; merely
replacing application files is insufficient. No migration or deployment has been
run against an existing installation by this change.

Run `pnpm test:security` (Podman by default; `VAULTS_CONTAINER_ENGINE=docker`
also supported) using locally available server-test and PostgreSQL images.
The script creates a dedicated empty database, shares only isolated loopback,
mounts source read-only, starts processes with explicit environments, and bounds
CPU, memory, processes, files, scratch storage and wall time. It removes both
containers afterward. It neither downloads dependencies nor contacts deployed
services. A parent-written receipt is retained in
`docs/security/server-hardening-verification.json`, including a source digest
and the test totals. Other opt-in database suites may be skipped; the dedicated
security database suite is required and enabled by this script.

# RB3 device-lifecycle candidate

Status: implementation candidate.

The isolated `@127vaults/device-lifecycle` package implements the authorization
state machine required by ADR-0003, ADR-0009, ADR-0014, and ADR-0015. The state machine is also integrated with the server's PostgreSQL
lifecycle adapter and authenticated routes. It does not establish completion of
the separate lost-last-device recovery ceremony or platform attestation.

## Implemented boundary

- Each device has an independent Ed25519 public identity and proves possession of
  its private key during enrollment.
- An active trusted-device session starts enrollment. The five-minute, one-use
  code/QR data binds account ID, enrollment ID, both session IDs, the proposed
  device ID and exact public key, and expiry. Trusted-device approval signs that
  complete binding. Any key/device/session substitution, bad signature, expiry,
  or reuse fails closed.
- Revocation increments the device authorization epoch and invalidates its server
  sessions. It cannot erase keys or ciphertext already held offline and is not
  described as remote wipe.
- Master-password rotation advances credential and global session epochs while
  retaining device approval. Account-secret rotation advances both epochs,
  revokes old device authorization, and leaves only the initiating replacement
  identity active; all other devices require online trusted reenrollment.
- Revoking the final device produces the explicit `lost_last_device` state.
  Recovery requires either an adapter-verified offline-kit proof or a pre-enabled
  selected-admin policy. Selected-admin recovery exposes no key/envelope field,
  waits four hours, supports cancellation, and requires a separately verified
  completion ceremony.

## Deliberate adapter contracts and open work

`recoveryProofVerified`, `ceremonyVerified`, and selected-admin policy eligibility
must eventually come from reviewed authentication/recovery adapters and durable,
transactional storage. They are not caller-controlled booleans in a transport API.
Likewise, `protection.class`/`verified` records an upstream platform-attestation
result only. This package neither performs attestation nor claims hardware backing.

PostgreSQL lifecycle transactions and authenticated enrollment/revocation/rotation
routes are implemented. Recovery begin/cancel/complete is not mounted: it requires
a reviewed purpose-bound recovery principal, transactional consumption, policy and
envelope rotation, notifications and interruption acceptance. Do not expose the
state-machine proof flags as caller-controlled HTTP input.

## Evidence

`pnpm --filter @127vaults/device-lifecycle test` covers successful approval,
one-time use, bad code, expiry, device/signer substitution, possession proof,
revocation/session invalidation, both credential rotations, and delayed
lost-device recovery. Repository checks remain the integration gate.

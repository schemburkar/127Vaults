# Security planning gaps

Reviewed 2026-09-08. Scope: an experimental, one-profile, private-vault web MVP.
Existing ECF1 approval permits disposable implementation; it does not approve real
secret storage. Nothing below blocks continuing that isolated fixture.

## Settle before the affected MVP work

| Gate | Recommended decision | Documents to reconcile |
| --- | --- | --- |
| Authentication | Complete Batch 5A before 5B: specify OPAQUE composition, server/Rust integration, credential updates and authenticated session binding; library availability alone is insufficient. | `implementation-batches.md` 5A/5B; ADR-0020; ADR-0014 |
| First-owner authority | Require an installation-local, single-use bootstrap capability; winning the first unauthenticated network request must not confer ownership. | ADR-0015; `implementation-batches.md` 6 |
| Web device identity | Specify first-device signing identity and its registration before signed sync; explicitly define browser persistence without claiming hardware protection. Batch 9 currently supplies identity after Batch 8A needs it. | ADR-0003; ADR-0009; `implementation-batches.md` 5B/8A/9 |
| Private transport | Choose certificate provisioning/trust and TLS termination for each supported non-loopback mode before network onboarding; private addressing is not transport authentication. Separate endpoint allowlists from future WebAuthn RP rules. | ADR-0012; `implementation-batches.md` 6/12 |
| Verified item revisions | Define authenticated body/index pairing and the trusted source of expected revision/epoch before durable sync; do not obtain “expected” context from the envelope being checked. | `experimental-crypto-format.md`; `sync/protocol.md`; `implementation-batches.md` 7/8A |
| Invitation email proof | Permit a bounded verification message or specify another independent proof; “email only for recovery/alerts” currently conflicts with verified-email registration. | ADR-0015; ADR-0016; `implementation-batches.md` 6 |

Paths above use `docs/product/` for batches, `docs/security/` for ECF1,
`docs/` for sync, and `docs/adr/` for the numbered ADR files.

## Resolve within the corresponding implementation batch

- Fix exact session expiry/refresh, cookie/CSRF controls, enumeration responses and request ceilings during 5A/5B; local vault lock and server session expiry are separate.
- Specify a sole-owner authentication-lock escape path before enabling the 20-failure rule; an attacker must not permanently strand the only administrator (ADR-0015).
- Freeze signed operation encoding, authorization history, checkpoint trust, snapshot completeness and pending-operation rebase before 8A/8B; AEAD alone proves neither authorship nor freshness.
- Measure ECF1 KDF cancellation, owned-buffer cleanup and real-browser entropy failures in 3C; add independent vectors before stable formats. Existing dependency evidence already records audit gaps.
- Define the administration permission matrix when those endpoints are added; default-deny unimplemented actions (ADR-0017).
- Verify backup restore and migration behavior before upgrades; an upload/checksum alone is not a restore drill (ADR-0005/0006).

## Contradictions to correct now

- ADR-0015 still says 15-minute lock; ADR-0019 and the user specify 30 minutes.
- ADR-0015 permits invitations to constrain an initial server role although the same ADR requires ordinary-user creation; remove elevated-role provisioning.
- `threat-model.md` unconditionally says server compromise does not disclose plaintext; qualify active server-delivered web code using `web-client-boundary.md`.
- `beta-readiness.md` requires extension/passkey reviews even for a web-only beta; make those gates conditional on feature inclusion, while retaining core authentication, crypto, sync and release checks.

## Later features: retain explicit gates

- **Selected-admin recovery:** a four-hour delay is not cryptographically enforceable against a colluding server/admin merely through a server timer. Specify the enforcement trust assumption and key-release mechanism before Batch 11B; do not imply stronger protection (ADR-0003; `threat-model.md`).
- **Lost-last-device recovery:** TOTP is a server authentication factor, not an offline decryption gate. Distinguish local recovery from online re-enrollment, and specify the approval exception before Batch 9/MFA (ADR-0003/0014/0015).
- **Offline revocation:** retaining the same root/vault keys cannot revoke previously held decryption capability; define future-key rotation and old-envelope limitations before adding devices/sharing (ADR-0014; ADR-0010).
- Hardware integrations, shared recovery/repair, extension autofill, passkeys, cloud failover, licensing emergency export and optional notary each need their own review before enablement; they need not delay the private web fixture.

No existing document, implementation or completion checkbox was changed by this audit.

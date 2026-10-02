# Batch 6 onboarding evidence

Status: internal-MVP implementation and loopback runtime complete.

Implemented:

- host-local 60-minute `127V-B1` generation; only a keyed digest enters PostgreSQL; regeneration invalidates the prior token;
- transaction-locked, single-use first-owner creation with active account, OPAQUE record and first device; owner email remains unverified;
- owner-only 24/48-hour invitations for 1–10 exact normalized emails, ordinary-user redemption, one seat per email;
- 10-minute attempts and eight-digit email proofs, five proof failures, 60-second resend, five sends/hour, source/install attempt limits;
- atomic invite recheck, email-seat consumption, account/credential/device insertion and idempotent committed-attempt result;
- implicit-TLS SMTP with certificate and hostname validation; fake mail remains test-only;
- bounded no-store HTTPS routes mounted in the private HTTPS listener. They
  refuse construction without Batch 5B's completion adapter; an OPAQUE upload
  is converted to a validated record and a signed first-device activation
  artifact is verified before persistence.
- onboarding unsafe requests now also require the exact configured HTTPS Origin
  and matching host-only ceremony-cookie/header CSRF value. Invitation creation
  still additionally requires the authenticated owner supplied by the eventual
  mounted session router.

Verified 2026-09-09:

- `pnpm --filter @127vaults/server check`: pass.
- `pnpm --filter @127vaults/server test`: 17/17 pass across onboarding,
  authentication and transport with fictitious identities.
- Canonical token/email/username rejection, single-use bootstrap, email-bound redemption, proof consumption and 24/48-hour policy have executable coverage.

Runtime evidence (2026-09-09):

- Fresh PostgreSQL schema initialization, HTTPS registration, atomic first-owner
  bootstrap, replay rejection, owner login and invitation creation passed.
- Missing SMTP returned 503 and did not activate the invited account.
- Invitation SQL required explicit timestamp casts; the live defect was fixed.
- On 2026-09-10 a disposable implicit-TLS SMTP capture on port 2465 supplied the
  eight-digit code; invited activation, OPAQUE/device login, and two-account
  vault isolation passed. The fixture is test-only and memory-only.

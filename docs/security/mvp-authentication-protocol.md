# Internal-MVP authentication contract

2026-09-09. Session and failure-state rules are accepted planning defaults. The
OPAQUE profile below is accepted for the fictitious-data internal MVP by
[Batch 5A evidence](opaque-feasibility-evidence.md). It is not public-beta or
production cryptographic approval.

## Protocol gate

Use RFC 9807 OPAQUE through the Rust core: `opaque-ke 4.0.1`,
Ristretto255 OPRF, TripleDH/Ristretto255/SHA-512, client Argon2id stretching.
Do not copy the library's example Identity stretching into authentication.
The RFC supports transcript context and explicit identities; these are required.
Sources: [RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html),
[versioned library documentation](https://docs.rs/opaque-ke/4.0.1/opaque_ke/).

Use the evidence document's exact graph and custom Argon2id profile. Batch 5B
must retain caller-owned zeroizing memory, validate browser cost, and fail closed
on entropy/allocation failure. Server messages cannot select arbitrary KSF work.

Candidate password input is a canonical byte encoding, passed directly to OPAQUE:
`ASCII("127Vaults/auth-input/1") || 00 || A[32] || u16be(len(P)) || P`.
`A` is decoded secret entropy; `P` is exact valid UTF-8, 1..1024 bytes, with no
normalization/truncation and the existing 20-grapheme creation policy. This is
length-delimited, not string concatenation. Never reuse ECF1-derived wrapping
material or OPAQUE export/session keys for vault encryption. Exact identifiers,
context and limits are frozen in the Batch 5A evidence; this remains an
application composition, not an RFC standardization of the two-secret policy.

## Identity and authenticated state

Use installation UUID plus normalized username as the OPAQUE credential lookup;
freeze username for MVP. Pin installation UUID and OPAQUE server public key at
registration through the trusted HTTPS onboarding connection. Browser identity
storage retains these public pins; unexpected change fails closed. First contact
still trusts the configured origin and its delivered code.

Freeze one application profile identifier. OPAQUE client identity binds
installation UUID/account UUID; server identity binds installation UUID/server
public key. Its context binds profile, canonical configured HTTPS origin,
credential epoch, attempt ID, client/server random nonces and registered device
ID. Encode fields with fixed-width integers/UUIDs and explicit byte lengths;
5A freezes exact bytes alongside the chosen library's wire serialization.
No algorithm negotiation, cross-origin redirects or automatic pin replacement.

Login is `start -> challenge -> password proof -> device proof -> session`.
A challenge lasts 2 minutes;
its random 32-byte attempt ID is single-use and bound to the start request.
After valid OPAQUE completion, a single-use 60-second intermediate capability
may fetch only that account's wrapped-root envelope and authenticated descriptor,
allowing the client to unwrap its locally stored browser identity. It cannot read
vaults, modify state, reset failures or issue a normal session. Bind these root
bytes and descriptor to the completed OPAQUE session with a separately derived
authentication tag; exact KDF/tag encoding is a mandatory 5A vector gate.
Only password proof plus proof of the already registered browser
signing key can issue a session. Bind device proof to the complete handshake,
attempt ID and epoch; 5A defines its exact signing bytes. A valid OPAQUE proof
alone cannot enroll a replacement device. Onboarding registers the first key
only inside its consumed bootstrap/invite ceremony.

One database transaction consumes the attempt, rechecks epoch/device/account
state, resets consecutive failures and creates the session. Credential updates
compare the expected epoch and atomically replace the OPAQUE record and wrapped
root, increment epoch, and revoke all sessions/pending handshakes. Password-only
changes preserve device approval; secret changes follow ADR-0014 reenrollment.
These update endpoints are post-MVP; 5B must store/check epochs from the start.

## HTTP session contract

- Random 32-byte opaque session token; store only its keyed digest with account,
  device, epoch, creation and expiry. Never put tokens in URLs or browser storage.
- Cookie: `__Host-127v-session`, `Secure; HttpOnly; SameSite=Strict; Path=/`, no
  Domain and no Max-Age/Expires. Server expiry is exactly 12 hours from creation;
  no sliding renewal or refresh token in MVP. Browser session restoration is
  possible, so cookie lifetime is not a browser-exit security guarantee.
- Same-origin HTTPS only, CORS disabled. Every unsafe request requires exact
  configured Origin and a session-bound random 32-byte CSRF value in
  `X-127v-CSRF`; reject absent/null/wrong Origin. Obtain the CSRF value from a
  same-origin no-store endpoint, keep it in memory, never log it. Pre-session
  onboarding/login use an equivalent expiring ceremony cookie and CSRF value.
- GET/HEAD never mutate. Accept only the named JSON content type and canonical
  base64url binary fields; reject duplicate/unknown keys and trailing bytes.
  All auth responses use `Cache-Control: no-store` and no secrets in errors.
- Revalidate active account, device and epoch on each authenticated request.
  Explicit logout revokes the row and clears cookie. Local lock clears plaintext
  and key handles independently; it does not extend server expiry or approve a
  device. Both credentials are required to unlock again under the web exception.

## Bounds and lockout

Auth request/response body ceiling is 16 KiB; profile messages must also match
their exact reviewed sizes. Reject unsupported profile before expensive work.
Allow at most 2 live attempts per account/device and 100 per installation;
expire attempts before admitting more. Limit starts to 10/minute/account and
30/minute/source with fixed windows; no trust in unconfigured proxy headers.
Return a generic bounded retry response when admission fails.

For completed wrong authentication proofs, increment once per consumed attempt
under an account transaction. Malformed transport, expiry, missing finish and
rate-limit rejection do not count as password failures. Unknown accounts execute
the library-supported fake-record path and use the same shape/error schedule;
bounded keyed lookup buckets prevent unbounded unknown-account storage.

After failures 1–4 delay is zero. After failures 5–19 delay seconds are
`5,15,30,60,120,300,600,900,1800,3600,3600,3600,3600,3600,3600`.
Failure 20 requires admin unlock. Account state is authoritative; enforce delay
before accepting another attempt. Account row locking prevents concurrent attempts
from bypassing the threshold. Public failures say authentication failed/contact
admin without confirming account existence; a validated password proof may report
the account lock state. Exact timing indistinguishability requires measurement,
not an invented constant-time claim. An attacker can deliberately trigger this
accepted account-lockout policy; source throttling reduces but cannot remove it.

## Sole-owner reset

Provide an operator command inside the server container, unavailable over HTTP,
requiring host/container administrative access and an explicit owner account UUID.
It checks the account is an existing owner, then atomically clears only failure
count, delay and admin-lock state and invalidates pending login attempts. Preserve
password record, root envelope, MFA, approval, roles and every key. Record an audit
event with operator-local reset reason and account UUID, never credentials. Wrong
ID/non-owner is an error. Repeated reset is harmless; no new session is issued.
The owner must still authenticate normally. This is not lost-credential recovery;
host administrators already control these server-enforced failure counters.

## Required negative evidence

5A/5B record wrong password/secret, unknown account, corrupt group element,
truncated/oversized/duplicate fields, replay/expired finish, changed origin or
server pin, substituted account/device/epoch, revoked device, concurrent finish,
credential-update race, CSRF/cookie rejection, expiry and owner-reset preservation.
Record failed checks as gates; never substitute a plaintext-password fallback.

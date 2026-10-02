# Batch 5B authentication evidence

2026-09-09. **Status: implementation and loopback runtime complete; wider runtime matrix pending.** This is disposable internal-MVP evidence,
not approval for real credentials.

Implemented in the Rust/WASM cryptographic boundary:

- the frozen `opaque-ke 4.0.1` Ristretto255/TripleDH/SHA-512 profile;
- exact account-secret plus password encoding and bounded inputs;
- exact credential, client, server, origin, device, epoch and attempt binding;
- caller-owned, fallibly allocated, zeroizing 64 MiB Argon2id workspace;
- exact 32/64/192-byte registration and 96/320/64-byte login messages;
- split registration/login APIs with serialized client/server state, fail-closed
  production entropy, real and fake-record server paths and generic failures;
- HKDF-SHA-512 application-key derivation and the exact root-response HMAC;
- Node-target WASM ceremony evidence with matching session keys and tamper rejection.

Implemented as narrow server policy/storage foundations:

- fixed-size OPAQUE/setup, device, attempt, failure, intermediate-capability and
  session tables; there are no password, account-secret or plaintext columns;
- strict JSON/base64url bounds, attempt/capability/session expiry, replay
  consumption, failure delay/admin-lock state, opaque token digests, exact-origin
  CSRF and the host-only secure session cookie;
- exact Ed25519 device-proof bytes and verification.
- bounded authentication HTTP/service seams for ceremony issuance, start,
  password completion, single-use root fetch, device proof, session CSRF and
  logout. All pre-session unsafe calls require the host-only ceremony cookie,
  matching header and exact configured Origin; normal sessions use the secure
  host-only cookie. The service requires a complete OPAQUE adapter, exercises
  the fake-record input, authenticates the root response before returning it,
  verifies Ed25519 possession, and zeroes its application session-key buffer.
- a split Node/WASM OPAQUE adapter with the Rust profile's exact binding and
  root-response HKDF/HMAC composition;
- a PostgreSQL adapter with transaction-locked attempt/capability/device/session
  consumption, fake-record lookup, per-account/source admission, credential
  epoch rechecks, encrypted-at-rest CSRF recovery, lockout and replay controls;
- mounted HTTPS registration, login, root-capability, device-proof, CSRF and
  logout routes. Registration returns a two-minute server-authenticated artifact
  binding the proposed account/device IDs; activation validates its OPAQUE upload
  and Ed25519 first-device signature before an onboarding transaction may insert
  the credential and device.

Verified offline:

- `cargo clippy -p vaults-crypto --all-targets --offline -- -D warnings`;
- `cargo test -p vaults-crypto opaque::tests --offline` — 2 passed;
- `cargo check -p vaults-browser-fixture --target wasm32-unknown-unknown --offline`.
- Node-target WASM split ceremony: passed in 398 ms on this development host,
  including two 64 MiB Argon2id operations; changed finalization was rejected;
- server policy/service/HTTP suite: 13 authentication tests passed (success, replay/concurrent finish, wrong/unknown
  generic error, 20-failure lock, attempt/capability consumption, binding,
  parsing, cookie/CSRF/Origin enforcement, fake-record orchestration,
  root-response tagging, registration-artifact substitution, activation proof
  and device proof). The full server suite is 17/17.

Live loopback evidence now covers OPAQUE login, root-capability consumption,
Ed25519 device proof, session creation and authenticated HTTPS use. It exposed
and fixed a PostgreSQL timestamp-parameter inference defect. Not claimed yet:
real-browser KSF/timing, unknown-account timing, or full socket-level concurrency.
No real-credential approval is implied.

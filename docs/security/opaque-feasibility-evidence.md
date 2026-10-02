# OPAQUE feasibility evidence (Batch 5A)

Reviewed 2026-09-09. **Decision:** suitable for the fictitious-data internal MVP;
not approved for public-beta or real-secret claims. Batch 5B may implement this
profile without a password-over-TLS fallback.

## Frozen dependency profile

- `opaque-ke = 4.0.1`, `default-features = false`, feature `ristretto255`;
  Ristretto255-SHA-512 VOPRF and `TripleDh<Ristretto255, SHA-512>`.
- Custom client KSF using `argon2 = 0.5.3` with Argon2id v1.3,
  `m=65,536 KiB`, `t=3`, `p=1`, 64-byte output and the OPAQUE library's
  all-zero 16-byte KSF salt. The OPRF output is already per-credential randomized;
  this salt is not an account salt.
- `sha2 = 0.10.9`, `rand_chacha = 0.3.1` only for deterministic probes, and
  the workspace's reviewed `wasm-bindgen = 0.2.126`. Production entropy comes
  from the existing fail-closed Rust/WASM entropy boundary, never deterministic RNG.
- Do not enable `serde`, `std`, `argon2`, Curve25519, ECDSA, Ed25519 or KEM
  features on `opaque-ke`. Wire persistence uses its fixed-length serializers.
- Do not use Argon2's allocating `hash_password_into`: its workspace `Vec<Block>`
  is not wiped on drop. Allocate 65,536 blocks with `try_reserve_exact`, wrap the
  caller-owned buffer in `Zeroizing`, then call
  `hash_password_into_with_memory`. Allocation failure is a generic client failure.

The isolated lock resolves 55 dependencies including the probe. A fresh
`cargo audit 0.22.2` scan loaded 1,242 RustSec advisories and returned no
vulnerability. Fresh resolution also proves selected versions were not yanked.
Eight resolved crates have build scripts and transitive dependencies contain
unsafe code; `unsafe_code = forbid` protects 127Vaults code, not dependencies.
The complete exact graph and checksums are reproducible from
`.tools/batch5a-opaque-probe/Cargo.lock` and must be copied unchanged when 5B
promotes the selection.

`opaque-ke` is MIT OR Apache-2.0, MSRV 1.85 (below this workspace's 1.98), and
has no native library/build script. The project reports an NCC Group audit of
0.5.0 with fixes in 1.2.0. That audit does **not** cover the substantial RFC-era
4.x delta. This is the principal residual risk and requires the planned
post-MVP security review before public-beta approval.

Sources: [RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html),
[`opaque-ke` 4.0.1 metadata](https://docs.rs/crate/opaque-ke/4.0.1/source/Cargo.toml),
[upstream audit statement](https://github.com/facebook/opaque-ke#readme), and
[4.x changes](https://github.com/facebook/opaque-ke/blob/main/CHANGELOG.md).

## Reproducible probes

Exact upstream tag `v4.0.1`, commit
`75fe4cdddb7946440054da0c8e7cdd73828af3f9`:

- upstream RFC 9807 Ristretto real/fake vectors: passed;
- full upstream library suite: 84 passed, including serialization, arbitrary
  malformed-input no-crash, reflected values, invalid login and fake records;
- local native registration/login with the frozen KSF: passed;
- `wasm32-unknown-unknown` compile with the frozen KSF: passed;
- fixed wire sizes, bytes: registration request 32, response 64, upload 192;
  credential request 96, response 320, finalization 64;
- RustSec exact-lock scan: passed.

The compile probe is not a browser performance result. Batch 5B must measure the
64 MiB KSF on supported browsers and fail closed if allocation or execution fails.

## Application encoding and binding

All integers are unsigned big-endian. UUIDs are their 16 network-order bytes.
Length prefixes are `u16`; reject overflow before allocation. Strings are exact
UTF-8 after the policy validation already specified; no normalization occurs.

- OPAQUE input: the existing
  `ASCII("127Vaults/auth-input/1") || 00 || account_secret[32] ||
  u16(password_bytes) || password_bytes`. Password is 1..1024 bytes.
- Credential identifier:
  `ASCII("127Vaults/credential-id/1") || 00 || installation_uuid || account_uuid`.
  Username is only the bounded database lookup key and is frozen for MVP.
- Client identity:
  `ASCII("127Vaults/client-id/1") || 00 || installation_uuid || account_uuid`.
- Server identity:
  `ASCII("127Vaults/server-id/1") || 00 || installation_uuid ||
  opaque_server_public_key[32]`.
- Login context:
  `ASCII("127Vaults/login-context/1") || 00 || u16(origin_bytes) || origin ||
  installation_uuid || account_uuid || device_uuid || u64(credential_epoch) ||
  attempt_id[32]`. Origin is the canonical configured HTTPS origin, at most 255
  ASCII bytes. OPAQUE's own KE1/KE2 randomness is already transcript-bound and
  is not duplicated here.

Registration binds the two identities; the library has no registration context
parameter. Login supplies identical identities and context to both finishes.
Server public-key/origin pins are established only in trusted onboarding and a
change fails closed. No negotiation or automatic migration exists.

The server receives only fixed-size OPAQUE messages and the credential identifier,
never the composed input, master password, account secret, KSF output, export key
or client session key. OPAQUE export/session keys remain forbidden for vault-key
encryption.

## Ceremony and limits

Registration is OPAQUE request/response/upload. Login is credential
request/response/finalization, followed by the existing registered-device proof
before session issuance. Unknown users call `ServerLogin::start` with `None`,
which generates the library's fake record; response sizes and public errors match.
Measure timing in 5B and retain the account/source admission limits in the
authentication contract.

Accept canonical unpadded base64url fields whose decoded lengths equal the six
sizes above. Reject unknown/duplicate JSON fields, trailing bytes, invalid group
elements and bodies over 16 KiB before expensive work. Keep at most two attempts
per account/device and 100 per installation; each attempt stores one bounded
client request, server response/state and expiry. The server, not a message,
selects the fixed profile and KSF.

There is no in-place OPAQUE password update. A credential change runs fresh
registration inside a current authenticated/device-authorized ceremony, then
atomically replaces the record, wrapped root and epoch as already specified.
Future suite migration must add a new explicit profile and authenticated
re-registration; never reinterpret a 4.0.1 record.

After login, let `T = SHA-512(credential_request[96] ||
credential_response[320] || credential_finalization[64])` and
`C = SHA-512(login_context)`. Derive application keys with HKDF-SHA-512:
`PRK = Extract(salt=SHA-512(ASCII("127Vaults/session-salt/1") || 00 || C),
IKM=OPAQUE_session_key)`, then Expand with the distinct ASCII info strings
`127Vaults/root-tag-key/1` and `127Vaults/intermediate-key/1`, each to 32 bytes.

The bounded root response bytes are `u16(descriptor_len) || descriptor ||
u32(envelope_len) || envelope`, with 4 KiB and 16 KiB maxima. Its tag is full
HMAC-SHA-512 under `root-tag-key` over
`ASCII("127Vaults/root-response/1") || 00 || C || T || root_response`.
The client verifies it before unwrapping its device key.

The Ed25519 device-proof signing bytes are
`ASCII("127Vaults/device-proof/1") || 00 || C || T || installation_uuid ||
account_uuid || device_uuid || u64(credential_epoch) ||
SHA-512(root_response || root_tag)`. The server verifies the registered device
key and the identical stored attempt fields. A random single-use 32-byte
intermediate capability is stored only as an HMAC digest under a server-local
key derived with the second label and expires after 60 seconds. It authorizes
only this root response. No session is issued until OPAQUE and device proof both
verify; session rows bind account, device and epoch as specified in the contract.

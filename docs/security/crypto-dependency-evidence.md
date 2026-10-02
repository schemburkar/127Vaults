# Batch 3A: crypto dependency evidence

Reviewed 2026-09-07. Documentation-only feasibility assessment; no dependency,
algorithm parameter, format, or production approval is made here.

## Finding

The proposed Rust family is viable for a shared native/browser core. No missing
primitive currently justifies a TypeScript implementation. This is an inference
from the pure-Rust libraries and browser binding support below, not a completed
build of the proposed dependency graph. Batch 2 proved the binding path with a
fixed fixture only. Actual crypto, randomness failure, resource use, and browser
engines still need the Batch 3C smoke checks and later automated vectors.

## Candidate snapshots and compatibility

Versions below are observed published snapshots, not approved pins. The registry
pages and older API pages sometimes return different latest versions; follow the
explicit version when implementing and recheck its package manifest and source.

| Purpose | Viable candidate and version evidence | MSRV and integration findings |
| --- | --- | --- |
| Password KDF | RustCrypto `argon2`: [0.6.0 registry](https://docs.rs/crate/argon2/0.6.0); [0.5.3 API](https://docs.rs/argon2/0.5.3/argon2/) is a reviewed older baseline. | 0.5.3 documents Rust 1.65 and pure Rust/no-std support. The 0.6.0 manifest was unavailable through this review's browser fetch; its MSRV/features must be verified before selecting it. Native and WASM feasibility is strong; memory/time limits and a worker boundary require measurement. |
| Content AEAD | RustCrypto [`chacha20poly1305` 0.11.0 manifest](https://docs.rs/crate/chacha20poly1305/0.11.0/source/Cargo.toml), compared with [0.10.1 API](https://docs.rs/chacha20poly1305/0.10.1/chacha20poly1305/). | 0.11.0 requires Rust 1.85. It moves to aead 0.6/chacha20 0.10/cipher 0.5/poly1305 0.9. Zeroization is an optional explicit feature in 0.11.0; do not assume older defaults carry over. Disable reduced-round variants. |
| Device signatures | [`ed25519-dalek` 3.0.0](https://docs.rs/crate/ed25519-dalek/latest), with [2.2.0 API policy](https://docs.rs/crate/ed25519-dalek/2.2.0) as comparison. | 3.x documents Rust 1.85; older 2.x documentation says 1.60. Pure Rust; keep zeroization enabled and avoid hazmat APIs. Strict verification semantics and weak-key rejection belong in the protocol specification. |
| Key agreement | [`x25519-dalek` 3.0.0](https://docs.rs/crate/x25519-dalek/3.0.0), compared with [2.0.1](https://docs.rs/x25519-dalek/2.0.1/x25519_dalek/). | 3.0.0 requires Rust 1.85 and curve25519-dalek 5/rand_core 0.10. Secret objects now zeroize on drop rather than expose the old Zeroize API. Native/WASM use the portable curve implementation where acceleration is unavailable. |
| Subkey derivation/hash | RustCrypto [`hkdf` 0.13.0](https://docs.rs/crate/hkdf/0.13.0) and [`sha2` 0.11.0](https://docs.rs/crate/sha2/0.11.0); older [HKDF API](https://docs.rs/hkdf/0.12.4/hkdf/). | Pure Rust candidates. Exact MSRVs were not recovered from versioned manifests in this review and remain a pin-selection check. Digest/HMAC major versions must agree; HKDF is not a replacement for the password KDF. |
| Entropy | [`getrandom` 0.4.3](https://docs.rs/getrandom/0.4.3/getrandom/); [0.3.4 browser behavior](https://docs.rs/crate/getrandom/0.3.4) as comparison. | 0.4.3 requires Rust 1.85. Native OS RNGs; browser uses Crypto.getRandomValues through the wasm_js feature. Enable browser support at the adapter/application boundary. Multiple getrandom/rand_core major versions need separate feature and error-path review. |
| Memory clearing | Existing [`zeroize` 1.8.2](https://docs.rs/zeroize/1.8.2/zeroize/). | Rust 1.72; documented WASM support. Volatile clearing protects the owned buffer, not all copies, registers, browser strings, swap, or crash dumps. Optional derives introduce build dependencies. |
| JS bindings | Existing `wasm-bindgen` 0.2.100 package/CLI, recorded in [Batch 2 evidence](../release/rust-browser-fixture.md). | Keep CLI/package versions matched. Workspace requires Rust 1.98, so verified candidate minima fit; unresolved minima still need checking. Existing fixture works in a browser, but its old build-tool dependency warnings require upgrade review. |

## Specifications and audit boundaries

Argon2id is described by [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html).
The RustCrypto implementation supports the family, but this review did not locate
an independent audit covering its current release. A standardized algorithm is
not an audit of its implementation. Review zeroization of both the KDF workspace
and output, including error paths; the older release's zeroize feature is
[optional](https://docs.rs/crate/argon2/0.5.3/features).

XChaCha20-Poly1305 has an extended nonce construction documented in an expired
IETF draft, not an XChaCha RFC; RFC 8439 specifies the underlying shorter-nonce
ChaCha20-Poly1305. The crate documents constant-time multiplication assumptions.
[Crate security notes](https://docs.rs/chacha20poly1305/0.10.1/chacha20poly1305/)
link to the [NCC Group review](https://www.nccgroup.com/research/public-report-rustcrypto-aesgcm-and-chacha20pluspoly1305-implementation-review/):
work occurred December 2019, published February 2020, five person-days. That is
approximately six and a half years old. It does not establish coverage of the
0.11.0 changes, our composition, browser JIT, or binding code.

Dalek's [2019 Quarkslab report](https://blog.quarkslab.com/resources/2019-08-26-audit-dalek-libraries/19-06-594-REP.pdf)
is approximately seven years old and concerns historical code, including low-level
curve/subtle work and Bulletproofs. Its description of an optional Ed25519/X25519
stage must not be turned into a current-release audit claim. The later
[curve timing advisory](https://rustsec.org/advisories/RUSTSEC-2024-0344.html)
was patched in 4.1.3; the [old Ed25519 signing API advisory](https://rustsec.org/advisories/RUSTSEC-2022-0093.html)
also demonstrates why version and API selection matter. Check current advisories
for the resolved graph, not just these historical examples.

HKDF has [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869.html) vectors and a
well-defined extract/expand construction. This review found no audit establishing
coverage of the chosen current HKDF/SHA-2/getrandom/zeroize combination. Treat
their audit status as unverified, not implicitly inherited from the AEAD audit.
Maintenance evidence is the upstream release histories linked in the table;
release activity does not promise continuing support or security.

## Browser and native boundary

Use the same Rust content-crypto implementation on both targets, with different
entropy/platform adapters. WASM is not a secure enclave: hostile server-delivered
JavaScript can inspect memory and input. The trusted-web warning remains required.
Hardware-backed device key storage is a separate platform task and is not supplied
by a pure-Rust signing crate.

Browser entropy failures must abort the operation with a redacted error and no
persisted key, nonce, or partial envelope. Never substitute Math.random, time,
UUID timestamps, cached entropy, or a fixed fixture. Check every request, including
after successful initialization. Getrandom's fallible API supports this approach;
verify generated JS exceptions and unavailable Crypto behavior in the actual
browser build. A successful first call is not permission to ignore later errors.
No nonce size or KDF cost is selected here.

Keep KDF work bounded before allocating attacker-supplied memory/time values.
Evaluate workers and cancellation without leaving duplicate secrets. Confirm
native and browser vectors agree despite different CPU backends; portable source
does not establish constant-time machine code under every compiler/JIT.

## Supply chain and next gate

Current local manifests contain zeroize 1.8.2 and the fixture's wasm-bindgen
0.2.100, not the proposed suite. Cargo.lock also contains binding macros and their
syn/quote/proc-macro2 dependencies. No proposed graph was resolved or audited here.

Before Batch 3C, record exact versions/features and target-specific transitive
graphs: Argon2's Blake2/password-hash dependencies; AEAD's cipher/poly1305 and
generic support; Dalek's curve/subtle/backend/derive dependencies; HKDF's
HMAC/digest/hash chain; and entropy's OS and JS bindings. Review build scripts,
proc macros, unsafe transitive code, licenses, yanks, advisories, duplicate majors,
package provenance and checksums. Workspace forbid(unsafe_code) does not forbid
unsafe code in dependencies. Pin the reviewed graph, use locked builds, and review
updates; pinning alone does not establish trustworthy provenance.

The existing CLI's yanked spin and buf_redux/multipart compatibility warnings are
build-tool findings already recorded by Batch 2, not claims about runtime crypto.
An updated binding/CLI pair must rerun the browser fixture and entropy checks.

Viable: the RustCrypto/Dalek family above, subject to exact-version evidence and
integration checks. Rejected for this slice: reduced-round ciphers, unsafe entropy
fallbacks, obsolete vulnerable versions, and a second TypeScript implementation
without a demonstrated Rust/WASM blocker. TypeScript is not inherently less or
more secure; a switch requires its own equivalent dependency and audit review.

OPAQUE remains a separate Batch 5A review: RFC alignment, audit/version gap,
master-password/account-secret composition, protocol binding, interoperability,
and denial-of-service limits are not approved by this report.

Disposition: sufficient evidence to draft Batch 3B's experimental specification;
no production or implementation go-ahead follows from library availability alone.
Open checks are exact MSRVs/features for unresolved versions, audit deltas,
resolved graph advisories, binding upgrade compatibility, browser entropy failure,
KDF resource ceilings, secret-copy behavior, and deterministic cross-target vectors.

Verification: read the handoff, ADR-0020, key-hierarchy notes, manifests/lockfile,
backlog and Batch 2 runbook; consulted the primary sources linked above; checked
this Markdown for whitespace and relative-link targets. No code, dependencies,
central backlog checkboxes, commits or external publication were changed.

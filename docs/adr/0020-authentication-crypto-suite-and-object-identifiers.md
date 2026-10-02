# ADR-0020: Authentication, candidate crypto suite, and object identifiers

- Status: Accepted for internal MVP; public-beta crypto review required
- Date: 2026-09-06

## Decision

The server never receives the master password. Server authentication must use a
reviewed augmented password-authenticated key exchange such as OPAQUE, or another
reviewed construction that preserves this property. 127Vaults will not invent a
password protocol. OPAQUE library maturity, RFC interoperability, WASM behavior,
account-secret composition, and independent audit coverage require a spike before
the protocol is frozen. The [MVP authentication contract](../security/mvp-authentication-protocol.md)
records the profile, and [Batch 5A evidence](../security/opaque-feasibility-evidence.md)
approves its exact dependency graph and parameters only for the internal MVP.

The client supplies OPAQUE with a versioned, domain-separated combination of the
master password and account secret rather than the master password alone. The
length-delimited byte encoding is specified in that contract and frozen by the
Batch 5A evidence. Simple string concatenation is
forbidden. This input is independently domain-separated
from material used to wrap the user root key.

The candidate content-cryptography family is:

- Argon2id for memory-hard password key derivation;
- XChaCha20-Poly1305 for authenticated content encryption;
- Ed25519 for device signatures;
- X25519 for key agreement;
- a reviewed hash/HKDF construction for domain separation and subkeys.

This family is not permission to compose primitives ad hoc. Exact parameters,
message formats, signature contexts, public-key validation, nonce generation,
key conversion rules, and algorithm migration must be specified and tested.

The preferred implementation is one Rust cryptographic core exposed through
narrow WASM/native bindings. TypeScript crypto is a fallback only if the Rust
implementation cannot meet browser security, compatibility, or maintenance
requirements. Two independent production implementations are avoided unless
cross-implementation testing and review justify the additional attack surface.

Persistent object and operation identifiers are randomly generated UUIDs. UUIDv7
may be used where timestamp ordering materially improves database locality, but
its approximate creation-time disclosure is accepted and documented. Identifiers
are never credentials, capabilities, bearer tokens, or authorization checks.

## Consequences

- Authentication cannot be implemented as sending the master password over TLS.
- Possession of only the master password or only the account secret is
  insufficient for server authentication.
- The initial crypto spike must evaluate the complete dependency and audit chain,
  not merely whether a crate compiles.
- UUID authorization always requires an authenticated actor and explicit policy.
- Formats remain experimental until deterministic vectors and review are complete.

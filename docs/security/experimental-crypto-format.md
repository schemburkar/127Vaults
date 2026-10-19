# Disposable content-encryption format ECF1

Date: 2026-09-07. Batch 3B specification, subject to coordinating review.
This is an experimental fixture format, not an approved account protocol or a
stable storage format. The stable
`SUPPORTED_CRYPTO_FORMATS` list remains empty. An explicit experimental capability
may advertise ECF1 separately; existing placeholder bytes are never ECF1.

Scope is local password/account-secret protection of a random root key, root-key
protection of a random private-vault key, and vault-key encryption of opaque item
body/index bytes. OPAQUE, server authentication, enrollment, device signatures,
X25519 recipient envelopes, sharing, recovery, backups and signed sync formats
are excluded. Do not infer those protocols from this specification. The existing
draft TypeScript ports need reviewed adapter changes before use: expected context
must be supplied separately on every unwrap, not trusted from its envelope.

## Conventions and primitive profile

All lengths below count bytes. Integers in this outer format are unsigned,
fixed-width big-endian. `||` means byte concatenation. `ASCII(s)` means exactly the
listed characters, without quotes, terminator, BOM or whitespace. No JSON, text
UUID, native struct layout, optional fields, varints or platform endianness is used
inside a cryptographic encoding. A range written `[a,b)` excludes `b`.

Suite byte `01` fixes Argon2id v0x13, HKDF-SHA-256 and full-round
XChaCha20-Poly1305. AEAD keys are 32 bytes, nonces 24 bytes, and tags 16 bytes.
HKDF uses RFC 5869 Extract followed by Expand with a 32-byte output; do not
substitute a bare SHA-256 hash. No algorithm negotiation or reduced-round variant
is supported. Argon2 parameters are specified below; this is a bounded experimental
profile whose browser performance still needs measurement.

Primitive references: [Argon2 RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html),
[HKDF RFC 5869](https://www.rfc-editor.org/rfc/rfc5869.html), and
[RustCrypto XChaCha API/security notes](https://docs.rs/chacha20poly1305/0.10.1/chacha20poly1305/).
These define primitives, not an audit of ECF1. Exact dependency versions/features,
audit deltas and native/WASM graphs remain the selection gate described in
[Batch 3A evidence](crypto-dependency-evidence.md).

## Canonical context C (93 bytes)

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 1 | purpose |
| 1 | 16 | tenant UUID |
| 17 | 16 | account UUID or zero sentinel |
| 33 | 16 | vault UUID or zero sentinel |
| 49 | 16 | object UUID or zero sentinel |
| 65 | 16 | revision UUID |
| 81 | 4 | plaintext schema version, exactly 1 |
| 85 | 8 | protecting key epoch, 1 through 2^64-1 |

UUID bytes are their RFC/network byte order, not Windows GUID mixed-endian order.
Non-sentinel identifiers must have RFC variant bits `10` and version 4 or 7;
nil, max UUID and other variants/versions are rejected. New fixture identifiers
use UUIDv4 from the OS/browser CSPRNG. Existing v7 identifiers may be bound as-is:
their time component is public metadata, never freshness, permission or entropy.
Revision UUIDs must specifically be UUIDv4 and newly generated for each new
encryption. They identify ciphertext versions, not causal ordering or signatures.

Purpose fixes the following context and decrypted-payload rules:

| Purpose | Meaning | Required account/vault/object | Epoch | Plaintext |
| --- | --- | --- | --- | --- |
| 01 | user-root envelope | account nonzero; vault/object zero | credential epoch | exactly 32-byte random root key |
| 02 | private-vault-key envelope | account/vault nonzero; object equals vault | vault-key epoch | exactly 32-byte random vault key |
| 03 | item body | account zero; vault/object nonzero | vault-key epoch | 1..1,048,576 bytes |
| 04 | item index | account zero; vault/object nonzero | vault-key epoch | 1..65,536 bytes |

Tenant and revision are always nonzero. Unsupported purposes are rejected.
Zero sentinel positions must be exactly sixteen zero bytes. The account is absent
from content context deliberately: ciphertext belongs to a vault, not a reader.
An account binds its private recipient envelope only. This reserves no permission
to implement shared recipient distribution. Body and index have distinct purposes
and fresh revisions; the later signed item manifest must bind their pairing.
The accepted [item revision policy](../sync/protocol.md#verified-item-revisions)
requires one authenticated logical revision to bind this exact pair. It does not
make their ECF1 revision UUIDs equal or change this disposable encoding. Batches
7/8A own the manifest and independently authenticated expected-context source.
Field-level encryption is not specified; a future field codec must introduce its
own reviewed purpose/schema and field binding before conflict sync is implemented.

The caller supplies independently expected C on decryption/unwrapping, including
the exact revision and epoch. All 93 bytes must match the parsed C before key
derivation. In 3C it comes from the local fixture's retained descriptor. A future
client must obtain it from authenticated account state/verified operation history,
not echo untrusted server bytes. Keys/handles carry their kind and tenant/account
or tenant/vault/epoch scope internally; an API caller cannot relabel a handle.
Creation takes a validated context template without a revision; the core generates
that revision and returns the resulting public C alongside the envelope. The
fixture retains this descriptor for later expected-context checks. Creation must
not accept an envelope-provided context or a caller-controlled revision override.

## Inputs, KDF and hierarchy

Master password P is valid, exact UTF-8, 1..1,024 bytes, with no trimming, Unicode
normalization, case folding, implicit terminator or replacement of malformed
input. A JS adapter must reject unpaired UTF-16 surrogates before UTF-8 encoding.
Embedded U+0000 is an ordinary byte, never a C-string terminator. The future
account-creation policy still requires 20 grapheme clusters and HIBP policy; this
byte API is not an account policy validator. Its 1,024-byte ceiling is an explicit
experimental input bound, not silent truncation or a final product maximum.

Account secret A is exactly 32 independent CSPRNG bytes held client-side. It is
not a UUID, a password hash, or the printable/QR string. Printable encoding and
checksum are a later ceremony; never KDF the encoded text. Root R and vault V are
separately generated independent 32-byte CSPRNG values, never derived from IDs,
each other, or the password. Use typed internal handles, no public raw-key getter.

For every purpose-01 creation/rewrap, generate a fresh 16-byte salt S and compute:

```text
D = Argon2id(P, S, version=0x13, m=65536 KiB, t=3, p=1,
             output_length=32, secret=empty, associated_data=empty)
PR = HKDF-Extract-SHA256(salt=A, IKM=D)
K = HKDF-Expand-SHA256(PR,
      info=ASCII("127Vaults/ECF1/root-wrap") || 00 || C, L=32)
```

This is a specified experimental composition, still requiring review, not an
OPAQUE input or claimed standard password protocol. Neither P, A, D, PR nor K may
reach a server. Do not reuse them for authentication. A future OPAQUE design must
use its independently reviewed domain-separated inputs. Losing A prevents ordinary
unwrap even with P; administrative/offline recovery envelopes are outside ECF1.

For purpose 02, unwrap R first, then derive:

```text
PV = HKDF-Extract-SHA256(salt=ASCII("127Vaults/ECF1/root-subkeys"), IKM=R)
K = HKDF-Expand-SHA256(PV,
      info=ASCII("127Vaults/ECF1/vault-wrap") || 00 || C, L=32)
```

For purposes 03 and 04, unwrap V first, then derive:

```text
PC = HKDF-Extract-SHA256(salt=ASCII("127Vaults/ECF1/vault-subkeys"), IKM=V)
K = HKDF-Expand-SHA256(PC, info=label || 00 || C, L=32)
label = ASCII("127Vaults/ECF1/item-body")  for purpose 03
label = ASCII("127Vaults/ECF1/item-index") for purpose 04
```

`00` is one literal zero byte separating the fixed label from fixed-size C. Root
and vault keys have independent uses; do not use R/V directly as an AEAD key or
convert them into signing/agreement keys. All intermediate password and HKDF
material is scoped to the operation and cleared on completion/error.

The only accepted root KDF tuple is `(65536,3,1)`. Both the floor and ceiling equal
that tuple: reject lower, higher, zero or unsupported values before allocation.
Argon2 workspace is exactly 64 MiB; request validation must precede allocating it.
Allow at most one KDF and one active crypto request per core instance, with no
unbounded pending queue. Additional calls return BUSY. A client owns one live
crypto worker; creating many workers is not a resource-control workaround.
Use an operation cancellation/generation guard, a 30-second caller deadline and
a worker boundary so lock can discard late completion. Timed-out work must finish
cleanup or its worker must be terminated before replacement; termination is not
proof that the runtime erased all memory. A slow device fails explicitly, never
lowers KDF parameters. Native callers also serialize work and discard late results.

Password rewrap retains R, changes S/revision/nonce and derives a new K. It does
not reencrypt V/items. Preserve R only inside the unlocked core; do not return it
to JS to rewrap. Credential epoch is supplied by later authenticated orchestration;
ECF1 does not authorize password changes or solve atomic server updates. Vault-key
rotation creates fresh V and a new epoch; old envelopes never become new-epoch
objects by editing their header. Root-generation rotation is outside this format.

## Envelope layout (157-byte header followed by ciphertext/tag)

| Offset | Size | Value |
| --- | --- | --- |
| 0 | 8 | magic: hex `31 32 37 56 45 58 50 00` (ASCII `127VEXP` then zero) |
| 8 | 2 | format: `00 01` |
| 10 | 1 | suite: `01` |
| 11 | 93 | context C |
| 104 | 16 | root salt S, or sixteen zero bytes for purposes 02..04 |
| 120 | 4 | memory KiB: 65536 for 01, otherwise zero |
| 124 | 4 | passes: 3 for 01, otherwise zero |
| 128 | 1 | lanes: 1 for 01, otherwise zero |
| 129 | 24 | fresh nonce N |
| 153 | 4 | ciphertext-plus-tag length L |
| 157 | L | XChaCha20-Poly1305 ciphertext followed by its 16-byte tag |

Header H is exactly bytes `[0,157)`, including L. AEAD associated data is
`ASCII("127Vaults/ECF1/envelope") || 00 || H`. Compute L as plaintext length plus
16 with checked arithmetic before encryption; output total length is 157+L.
AEAD does not encrypt H. The parser rejects any surplus/trailing data, missing tag,
truncation, unknown version/suite, noncanonical sentinel, bad UUID or parameter.
For 01/02 L is exactly 48. For 03 L is 17..1,048,592. For 04 L is 17..65,552.
Absolute envelope maximum is 1,048,749 bytes. No compression, chunking, padding,
extensions, multiple concatenated envelopes or alternate encodings are supported.

Transport may later encode these bytes, but 3C accepts/emits byte arrays only.
Any later base64/JSON adapter needs its own pre-decode size/canonicality limits;
it must not change the AEAD bytes. Schema 1 payload is an opaque byte string to
this layer; the application validates item encoding only after authentication.
Root/vault unwrap never returns its decrypted payload as application plaintext.

## Randomness, lifecycle and bounded failure

Generate each key, salt, revision and nonce with a fallible OS CSPRNG, or browser
Crypto.getRandomValues through the reviewed Rust adapter. Never use time,
Math.random, UUID timestamps, deterministic seeds or previous random output as
fallback. Check every RNG call, including after earlier success. Entropy failure
aborts atomically: no envelope, handle, partial key or pending storage record is
published. Clear buffers already allocated. Failure injection/fixed bytes exist
only in an explicitly disposable smoke/vector harness and are not selectable by
normal WASM callers.

Each encryption allocates its revision and nonce internally; normal callers do
not supply either or reset an RNG. Byte-identical retransmission of an already
finished envelope is permitted; editing plaintext or AAD requires a new encryption.
Random 192-bit nonces plus context-derived per-revision keys make accidental
reuse unlikely but are not a proof against compromised entropy. Never promise
collision detection across restores/devices. For this fixture only, one core
instance permits at most 1,000 new encryptions before explicit fixture reset;
release/unwrap must not reset the instance counter. This is a development resource
bound, not a cryptographic key-life guarantee across reloads or a product policy.
It does not apply to decrypting copied fixtures.

Before any secret-dependent work, check total input lengths, all header fields,
purpose payload bounds, expected context and handle scope. Use checked arithmetic
for every length/offset and validate slices before access. Reject input above the
maximum at the JS boundary before copying and again in Rust. Untrusted plaintext
length never sets KDF memory. No parser recursion or attacker-selected collection
allocation. Maximum live secret handles is 32 per core instance, storing only
32-byte R/V keys plus fixed-size scope/counter metadata; release/lock invalidate
them permanently within the instance. The interface must also reject handles
from replaced/foreign WASM instances, including numeric-ID coincidence.

Decrypt into owned temporary memory, release plaintext only after the full tag
verifies, and discard/clear it on every failure. Key unwrap validates 32-byte
length and publishes a typed handle only after success. Lock clears all owned
keys/temporary plaintext and invalidates in-flight generation tokens, so late
KDF/decrypt/encrypt results cannot repopulate the store or UI. Input JS buffers
are cleared as soon as ownership transfers; no secret strings are stored in logs,
exceptions, URLs, browser storage or debug output. Plaintext item bytes necessarily
cross the trusted local WASM/JS boundary when opened, never a server boundary.
WASM memory, JS copies, registers, allocator remnants and a compromised browser
are not made secret by handles or best-effort zeroization.

Public errors are fixed codes only: INVALID_INPUT, UNSUPPORTED_FORMAT,
CONTEXT_MISMATCH, AUTHENTICATION_FAILED, INVALID_HANDLE, LIMIT_EXCEEDED, BUSY,
ENTROPY_UNAVAILABLE, CANCELLED and INTERNAL_ERROR. Malformed/unknown input and
public context may have distinct codes; all valid-envelope wrong-password,
wrong-account-secret, wrong-key and tag failures share AUTHENTICATION_FAILED.
Errors contain no values, provider text, stack traces or partially decrypted
bytes. Resource allocation failure must fail closed; a trap invalidates the entire
instance and its handles, never reports success. Do not claim uniform timing for
public parse errors or zeroization after an allocator abort.

## Threat review and scope limits

| Failure | Required defense and residual limitation |
| --- | --- |
| Nonce reuse | Internal fresh CSPRNG nonce/revision, derived per-context keys, immutable retransmission; compromised/replayed RNG remains a blocker, not repairable by timestamps. |
| Ambiguous encoding | Fixed-width big-endian header, exact lengths/sentinels/UUID byte order, exact labels and authenticated entire H; reject rather than normalize. |
| Cross-tenant/account/vault substitution | Independently expected C plus typed key scope and C in HKDF/AAD; trusting C from the same unverified envelope defeats this defense. |
| Malformed input/DoS | Length/parameter validation before copying/KDF, fixed cost, serial worker, request limits and fail-closed errors; hostile JS can still exhaust its own process. |
| Rollback/replay | AEAD authenticates bytes, not latest state. Retained expected revision rejects a different one; replay of the same valid envelope succeeds intentionally. No signed history/checkpoint claim until Batch 8. |
| Memory copies | Scoped zeroizing Rust storage, no key dump, lock generation guards; JS strings/JIT/runtime/OS copies cannot be comprehensively erased. |
| WASM/JS exposure | Local assets and narrow API reduce accidental leakage; active malicious server-delivered JS can capture passwords/keys/plaintext. Persistent trusted-server warning remains required. |
| Metadata and length | Header reveals purpose, IDs, epochs/revisions and payload length; v7 IDs reveal time. No metadata confidentiality or traffic analysis protection is claimed. |
| Forged authorship | Any holder of V can create valid content. AEAD is not a device signature, authorization proof, membership policy or nonrepudiation. |

## Deferred deterministic vectors and acceptance evidence

Do not create a self-generated round trip and call it independent cryptographic
validation. This historical specification does not establish current automated vector coverage;
before stable/beta use add frozen native/WASM expected-hex vectors with reviewed
primitive reference outputs. Each vector records P bytes, A/S/R/V/N, every C/H
byte, D and intermediate PR/PV/PC/K, AAD, ciphertext/tag and expected error.
These are public synthetic fixtures only, with deterministic inputs possible
solely through the non-production harness. Required cases:

- All four purposes; UTF-8 non-ASCII and U+0000 password; composed/decomposed
  Unicode produces distinct outputs; empty/malformed/oversized inputs rejected.
- UUID byte order, v4/v7 scope inputs, forbidden nil/version/variant, all sentinel
  rules, epoch boundaries and overflow; changed purpose/ID/revision/schema/epoch.
- Exact byte vectors for every HKDF label and full AAD; wrong key, password or
  account secret; modified header, nonce, ciphertext/tag; truncated/trailing bytes.
- Every length and KDF bound at/below/above boundary, unknown suite/version and
  nonzero reserved fields; root/vault payload lengths cannot become item bodies.
- RNG failure at every generation stage, no output/handle publication; stale,
  wrong-scope/foreign handles, lock/cancel during KDF and failure cleanup.
- Password rewrap preserves R/V and item ciphertext; changed root salt/revision/
  nonce changes envelope; exact valid replay illustrates the freshness limitation.

For 3C, run the specified disposable native and real-browser smoke flows, including
wrong context, tamper, malformed envelopes, limits, entropy failure, lock and error
redaction. Record resource measurements and workspace clearing behavior for the
selected libraries. A native pass plus a WASM compile is not browser evidence.

## Version refusal, disposal and implementation gate

Unknown magic/version/suite/schema is rejected, with no trial of other algorithms,
legacy fixture decoder, lower KDF or plaintext fallback. A future format gets a
new version and labels; changing any ECF1 byte/KDF meaning in place is prohibited.
Protocol, database schema, ABI and crypto-format versions remain independent.

ECF1 data must be disposable at every demo entry point. Before replacing it,
explicitly identify and delete only that fixture's storage with user consent, or
provide a separate reviewed client-side migration that authenticates/decrypts old
data and reencrypts into the new format with fresh salt/revisions/nonces and
verifies the result before deleting the source. No migration is implemented or
promised by this document. Never reinterpret ECF1 as stable, auto-delete unknown
data, silently reset on authentication failure, or upload plaintext to migrate.

Gate: GO for Batch 3C's disposable implementation after coordinating review of
this specification and exact dependency/version/feature selection from 3A. Keep
only Argon2id/AEAD/HKDF/hash/randomness dependencies needed by this slice; no
signing/agreement or OPAQUE implementation is implied. No approval for
stable formats, authentication, persistent product storage or production-security
claims. Outstanding risks are composition review, current dependency audit gaps,
actual KDF performance/cancellation/workspace clearing, binding memory copies,
cross-target deterministic vectors and the later authenticated expected-context
source. Any implementation divergence returns to this specification for review.

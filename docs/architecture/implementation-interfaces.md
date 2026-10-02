# Interface map for concurrent implementation

Revision 1 is a **draft coordination surface**, not frozen protocol, crypto format,
complete security specification, or evidence that the methods are implemented.
Use `import type` from the api-contract package's `contracts`, `client-contracts`,
or `lifecycle-contracts` subpath. These are type-only exports, not runtime modules.
`pnpm check` now checks these contracts with strict TypeScript settings.
Existing `.mjs` bodies still have syntax checks; full JS/TS implementation
conformance is a separate task. Interfaces do not provide runtime input validation.

## Ownership and handoff map

Each row can be claimed by one human or agent in the implementation backlog.
No owners are assigned automatically. Agree on contract changes before changing
another workstream's files; implement one port at a time and update status with
verification evidence. Add adapters with `implements` or `satisfies`; do not
silence incomplete work with type assertions or successful dummy responses.

| Workstream / owned paths | Draft ports | Current state and prerequisite |
| --- | --- | --- |
| Rust core: `crates/crypto` | Client `CryptoCore` | Secret ownership/handle feasibility only; KDF, randomness, wrapping, AEAD, signing and ABI review pending |
| Authentication: `apps/server/src/auth/` | `AuthenticationService`, `OnboardingService`, `CredentialService`, `MfaService` | No usable auth; OPAQUE/email/first-device design required |
| Accounts: `apps/server/src/accounts/` | `AccountService`, `DeviceService` | Local provisional records only; authenticated role/enrollment ceremonies pending |
| Vault policy: `apps/server/src/vaults/` | `VaultService`, `RecoveryPolicyService` | Tenant authorization, key epochs and accepted ownership transfers required |
| Sync: `packages/sync` | `SyncTransport`, `EncryptedReplica`, `ConflictController`, `IntegrityRepairService` | Cursor validator only; authenticated operations and causal conflict design required |
| Client item/UI: `apps/web`, `packages/domain` | `ItemController`, `LoginItem`, `LoginIndex`, `ClientPlatform` | Login model/session component exists; crypto/unlock integration pending |
| Recovery/history: separate server modules | `RecoveryService`, `HistoryService`, `RemoteWipeService` | Delay, authorization, audit and notification state machines required |
| Operations: separate server modules | `OperationsService`, `NotificationService` | Health and empty schema init exist; restore proof, deployment hardening and notification templates pending |
| Commercial: separate server module | `LicenseService` | Deferred until products exist; emergency-export policy required before lockout |
| Optional features | `OptionalCapabilities` | Passkeys, attachments and notary remain disabled; do not invent their payloads here |

This map covers the planned component scope, not every future endpoint. Exact
signatures for disputed ceremonies must be revised after the design review;
do not implement an insecure shortcut to satisfy a draft type. In particular,
MFA proof formats, first-device enrollment, rotation atomicity, and recovery-key
release require dedicated designs. Request context is a transport proof, never
permission by itself: the server must authenticate it and derive the actor before
authorizing each operation. Notification ports are internal, never public APIs.

Opaque branded strings distinguish IDs, ciphertext, signed/verified operations,
and local key handles at compile time. They are **not serialization choices or
validation**. No length/encoding, PAKE message, signature layout, or AAD byte
encoding has been selected. `CipherContext` names the intended binding inputs;
it must not be serialized ad hoc. No server-facing method accepts a master
password, account secret, raw content key or plaintext login item.

The trusted client `CryptoCore` is intentionally separate: unlock inputs and
decrypted bytes necessarily cross that local boundary. Secret handles should be
used for later key operations. The current Rust store is not this complete port,
and no network or WASM wrapper for secret access exists. Web uses no persistent
replica; installed clients may implement `EncryptedReplica`. An unverified
operation must never be treated as verified by a type cast.

## Rust feasibility result

Rust 1.98.1 native execution and `wasm32-unknown-unknown` compilation succeeded.
`SecretBuffer` owns bytes in pinned `zeroize` 1.8.2 storage, has redacted Debug,
and exposes no Clone/serialization implementation. `SecretStore` limits entry
count, rejects released/foreign handles, and drops its entries on lock. IDs are
monotonic within a native process or a WASM instance and never reused there.
Bindings must also isolate handles between separate WASM instances. Count limits
are not byte quotas; eventual key APIs must enforce key/input size limits.

The native `feasibility` example verifies redaction, access, capacity, invalidation,
non-reuse, cross-store refusal and repeated release behavior using disposable bytes.
It is an executable smoke example, not a unit-test suite. Strict Clippy passed.
Batch 2 subsequently added generated web bindings and verified fixture execution
in a browser; see [the browser runbook](../release/rust-browser-fixture.md).
Randomness, Argon2 performance, OPAQUE interoperability and independent audit
remain unproven. `SUPPORTED_CRYPTO_FORMATS` is empty, intentionally.

Zeroization is best effort for the owned allocation, not proof of erasing copies,
allocator remnants, registers, swap, process dumps or JS strings. Native `expose`
is an explicit trusted-core borrow and must never be exported through WASM.
Review the dependency and the entire cryptographic composition before real secrets.

## Verification commands

```sh
pnpm check
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p vaults-crypto --example feasibility
cargo build -p vaults-crypto --target wasm32-unknown-unknown
```

`pnpm check:rust:core` groups the Rust commands without running unit tests.
Install the WASM target with `rustup target add wasm32-unknown-unknown` if absent.
On this Windows host, Rust binaries live in `C:\Users\shubh\.cargo\bin`; add
that directory to PATH when using the grouped command.

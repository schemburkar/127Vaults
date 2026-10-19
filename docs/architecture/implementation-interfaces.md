# Implementation and interface map

The TypeScript ports in packages/api-contract describe shared boundaries. They
are type-only exports, not runtime validation or proof of implementation. The
[API v1 contract](api-v1-contract.md) records route behavior; source and tests
remain authoritative for the implemented internal release.

| Area | Source | Internal implementation |
| --- | --- | --- |
| Crypto and authentication | crates/crypto; apps/server/src/auth-*.mjs | Experimental native/WASM crypto and OPAQUE authentication; independent review remains a release gate. |
| Accounts and devices | apps/server/src/onboarding*.mjs; device-*.mjs; packages/device-lifecycle | Owner/invite onboarding, trusted-device enrollment, revocation and credential epochs. Lost-last-device recovery is a separate incomplete ceremony. |
| Encrypted persistence and sync | apps/server/src/private-vault*.mjs; sync-*.mjs; packages/sync | PostgreSQL persistence, signed operations/checkpoints and client replay/conflict handling. |
| Clients | apps/web; apps/desktop; apps/cli; apps/extension | Online browser, installed encrypted replicas, and browser connector; see component backlogs for acceptance limits. |
| Shared UI and contracts | packages/ui; packages/domain; packages/api-contract | Reused UI, client models, HTTP boundaries and TypeScript contracts. Required workspace source. |
| Operations and licensing | deploy; scripts/ops; apps/server/src/license-*.mjs | Guarded install/backup/restore/upgrade and signed-license enforcement. Contractual use limits exceed some offline technical enforcement. |

Do not satisfy a port with dummy responses or treat a type assertion as verified
cryptographic state. Authenticate actors at the transport boundary and supply
expected contexts independently when verifying envelopes. Plaintext and usable
vault keys remain client-side. Lock cleanup and zeroization have platform limits.

Run pnpm check and the relevant tests after interface changes. Rust commands are
cargo fmt --check, cargo clippy --workspace --all-targets -- -D warnings, and
cargo test --workspace. Browser builds require wasm32-unknown-unknown and the
pinned wasm-bindgen CLI; see the [fixture guide](../release/rust-browser-fixture.md).

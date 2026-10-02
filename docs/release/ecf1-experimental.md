# Disposable ECF1 implementation evidence

Date: 2026-09-09. Fictitious, disposable data only.

Implemented in `vaults-crypto` and the browser fixture:

- exact ECF1 contexts, headers, Argon2id/HKDF/XChaCha20-Poly1305 hierarchy;
- caller-owned, fallibly reserved, zeroizing 64 MiB Argon2 workspace;
- internally generated keys, salts, revisions and nonces with fail-closed entropy;
- typed, instance-scoped, non-reused root/vault handles; lock invalidation;
- bounded parsing, allocation, creation count, payload sizes and fixed error codes;
- narrow WASM byte API with no raw-key reader. Stable formats stay disabled.

Strict Clippy, workspace tests and `pnpm fixture:build` passed offline with the
reviewed 38-package lock. Native tests cover hierarchy/item round trip, wrong
password, tamper, trailing bytes, wrong context, lock invalidation, a frozen
disposable item-envelope vector, and a debug assertion that the caller-owned 64 MiB
Argon workspace is zero after use. Generated WASM instantiated in Node passed the
hierarchy/item flow and lock invalidation; removing Web Crypto returned only
`ENTROPY_UNAVAILABLE`. JavaScript syntax passed. The known local `node_modules` ACL
still makes `tsc` fail with `EPERM`; no TypeScript source failure was reported.

The real in-app browser ran Rust/WASM in a dedicated serial worker and visibly
reported PASS for the fixed 30-second deadline (worker termination and replacement),
BUSY rejection, lock cancellation/late-result isolation, round trip, tamper, short
and trailing malformed envelopes, unsupported magic, context mismatch, empty and
oversized payload limits, lock invalidation, and fixed redacted error codes.

Disposable Batch 3C is complete. A stable-format gate still requires independently
produced cross-implementation vectors and production cleanup review. The browser's
non-configurable Web Crypto global prevented safe in-page injection of missing and
throwing providers; the equivalent generated-WASM Node check above remains the
entropy-failure evidence. The 3C1 CLI graph warning remains release-blocking. This is
not a stable format, production zeroization claim, authentication system, persistence
layer, or approval for real passwords.

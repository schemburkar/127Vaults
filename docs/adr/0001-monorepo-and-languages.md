# ADR-0001: Monorepo and implementation languages

- Status: Proposed
- Date: 2026-09-06

## Decision

Use one repository. TypeScript is the default for the web app, extension, server,
API contracts, and initial sync orchestration. Rust owns the cryptographic core,
native security integrations, and eventually native CLI behavior. The Rust core
is exposed through narrow Wasm bindings in browsers and native bindings in the
Tauri Windows client. Mobile is deferred.

## Why

The first clients are web and browser extension, making TypeScript the most useful
shared application language. Rust provides memory safety and a viable native/Wasm
boundary for the smaller, heavily reviewed cryptographic implementation. The
server is intentionally outside the vault-decryption trust boundary, so Rust has
less marginal security benefit there than in client key handling. A monorepo lets
protocol changes and cross-language test vectors land atomically.

## Trade-offs

- Two language toolchains increase build complexity.
- Rust-to-Wasm and native bindings require careful secret-memory review.
- Browser constraints may force a separately reviewed WebCrypto adapter.
- TypeScript cannot guarantee secret zeroization; browser memory is explicitly a
  constrained security environment.
- This does not make the design secure; external cryptographic review remains a
  release requirement.

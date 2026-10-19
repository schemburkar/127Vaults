# Batch 2: actual Rust execution in the browser

This local demonstration compiles `crates/browser-fixture` to WASM and loads it
through generated wasm-bindgen web bindings. It creates only fixed disposable
fixture bytes inside Rust. It does not accept user secrets, read fixture bytes
through its adapter, implement encryption, or enable any crypto format.

## Run

Prerequisites: Rust 1.98.1 and Node 24 (pnpm 11.19.0 for aliases).
Run these from the repository root once:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.126 --locked --root .tools/wasm-bindgen
```

Then:

```sh
pnpm fixture:dev
```

Open [the fixture page](http://localhost:12781). The command builds first, then
serves exact allowlisted local assets on IPv4 loopback. It does not use PostgreSQL,
change `.env`, or interact with the development helper being hardened separately.
Stop the preview with Ctrl+C. Rebuild with `pnpm fixture:build`; use
`pnpm fixture:serve` when the generated assets already exist.

On Windows, Rust executables are normally under `%USERPROFILE%\.cargo\bin`.
The build helper discovers that directory and the workspace-local binding tool.
The package and CLI versions must match; the helper rejects a different CLI.
Generated files in `apps/web/wasm` are ignored and must be regenerated after Rust
changes. Builds use the committed Cargo lockfile; a missing target or failed
compile fails the command instead of opening an older build automatically.

The binding mode follows the official
[wasm-bindgen web deployment documentation](https://wasm-bindgen.github.io/wasm-bindgen/reference/deployment.html).
Version 0.2.126 is an experimental reproducibility pin, not a production approval
baseline. Its locked CLI installation reported yanked `der 0.8.0` and
future-compatibility warnings for `buf_redux`/`multipart`. Those CLI-only findings
block release approval but are not part of the browser runtime dependency graph.

## Observable acceptance steps

1. The page reports “Loaded · actual WASM”, interface revision 1, and no crypto
   formats, read from the compiled Rust adapter.
2. Click **Create fixture**. The current handle becomes valid in Rust.
3. Click **Lock**. Current state clears; the previous handle becomes invalid in Rust.
4. Create again. The new handle is valid and the old handle stays invalid.
5. Click **Check handles** to query the Rust store again.
6. Open the page's **Check missing-WASM error** link. It deliberately requests a
   nonexistent WASM file; an error appears and every fixture action is disabled.
7. Return to `/` or reload the normal URL to obtain a new isolated page session.

No account bootstrap or authentication bypass is involved. The demo calls the
session's unlock-entry method only to exercise a disposable fixture. Do not
copy this entry path into real account onboarding.

## Ownership and lock behavior

`FixtureCore` has one Rust secret-store entry. The JS facade owns its generated
Rust object and up to two opaque tokens (current and previous); it never hands
raw pointers to the UI. Foreign facade tokens are rejected, and the underlying
Rust store also rejects another store's token. Explicit lock, idle deadline, and
session disposal call the Rust lock synchronously. Page exit disposes the bridge;
a restored back/forward-cached page reloads instead of reusing freed objects.

There are no methods for supplying arbitrary secret bytes or retrieving them.
This does **not** protect against malicious JavaScript: generated bindings expose
WASM memory to their JS host, and the fixed fixture also exists in the binary.
The intended guarantee here is that the narrow supported fixture API has no secret
reader, not that WASM provides an isolated secret enclave. Zeroization remains
best effort; rendered UI and Rust-owned state are cleared, not every possible copy.

## Verification — 2026-09-06

Verified in the actual Codex in-app browser: initialization, capability display,
create/lock, repeated creation with the previous token still invalid, explicit
validity check, and missing-WASM failure with disabled controls. The final page
was left locked with its previous handle invalid. Visual inspection passed.

An ad hoc Node smoke check instantiated the **same generated WASM binary** and
confirmed Rust capacity enforcement, facade and Rust cross-store rejection,
access-time idle expiry through the session hook, stale tokens after a new
fixture, and disposal invalidation. Controlled time was used for that check;
we did not wait 30 wall-clock minutes in a browser.

`pnpm check`, native Rust smoke execution, `cargo fmt --check`, strict workspace
Clippy, and `pnpm fixture:build` passed. No unit tests were added. Browser-specific
timer suspension, back/forward cache, repeated-instance memory profiling and
other browser engines remain deferred. This completes the bounded fixture batch,
not the core encryption/key-hierarchy or full client-lock product requirements.

## Toolchain upgrade verification — 2026-09-09

The package and workspace-local CLI were upgraded together to 0.2.126. Locked
WASM build, formatting, strict Clippy, workspace tests, and `pnpm check` passed.
The helper rejected simulated 0.2.125 and 0.2.127 expectations. Two consecutive
generated builds produced identical SHA-256 hashes for all four outputs.

The runtime graph has one binding version and no duplicate packages. Generated
glue adds no `eval`, dynamic function construction, remote URL, npm import, or
supported secret-reading API; it still exposes normal host-visible WASM memory.
No browser-engine matrix was rerun. Advisory/license automation and release
approval remain open because the locked CLI graph contains the findings above.

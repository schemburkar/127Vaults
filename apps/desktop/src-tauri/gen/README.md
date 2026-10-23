# Generated Tauri metadata

`schemas/` is local build output. `build.rs` calls the locked
`tauri-build` 2.6.3 dependency, which generates ACL manifests, capability metadata,
`desktop-schema.json`, and the host platform's schema before compiling the app.
Windows and Linux generate their own platform schema; do not copy one platform's
output into source control or use it as a runtime input on another platform.

Run `pnpm --filter @127vaults/desktop check` to regenerate the files with the
workspace's pinned pnpm, Node, Rust, and Tauri dependencies. This includes frontend
checking/building followed by the existing native Cargo check. Missing native
Linux prerequisites are listed in the desktop README.

For an independent committed-source probe with `schemas/` absent:

```powershell
node scripts/check-desktop-schemas.mjs --output C:/path/outside-checkout/new-probe
```

Run the same script with a POSIX output path on Linux. It extracts a committed
snapshot without `gen/`, installs locked dependencies, runs the existing desktop
check, and writes `schema-receipt.json` only after validating regenerated JSON.
The output directory must be new and outside the checkout. Windows and Linux
probes passed before removing the generated snapshots from Git. Dependency locks,
the vendored Windows headers, their upstream notices, and crypto word lists
remain tracked source/build inputs.

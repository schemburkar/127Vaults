# Desktop platform phase 1 — 2026-10-08

Follow-up: a separate Ubuntu 24.04 environment was subsequently installed;
see [Linux setup and verification](linux-ubuntu-24-setup-2026-10-08.md) for the
newer evidence. The observations below describe the original gate-creation run.

The shared Tauri desktop now has a repeatable Windows/Linux development gate:
`pnpm check:desktop`. It checks native Linux prerequisites, TypeScript/Vite,
desktop JavaScript tests, shared CLI library tests, and a locked Tauri release
binary build without bundling. The GitHub workflow runs independent Windows and
Ubuntu 24.04 jobs; failure on one does not cancel the other.

## Evidence from this checkout

- Windows: the complete gate passed. TypeScript, Vite and Cargo check succeeded;
  11 desktop tests and 37 shared CLI tests passed. Tauri produced
  `target/release/vaults-desktop-poc.exe` successfully.
- WSL: rechecked the installed distro as Ubuntu 20.04. `pkg-config --modversion
  webkit2gtk-4.1` failed because the package is absent. No Linux desktop build or
  GUI launch was performed. The earlier [Linux CLI evidence](linux-wsl-check-2026-10-06.md)
  remains limited to that earlier revision's 36 CLI tests.
- The CI workflow is committed locally, but has not been pushed or executed.
  Its Linux result is pending; adding a matrix is not evidence of a passing build.
- A trial strict desktop Clippy invocation failed in existing shared crypto code:
  missing `# Errors` docs on account-settings encryption/decryption and identical
  match arms in `crates/crypto/src/ecf1.rs`. The new gate covers compilation and
  tests; the existing `check:rust` strict quality gate remains separate and these
  findings remain unresolved.

## Next phase

Run the gate on a separate Ubuntu 24.04 environment, then follow the GUI/keyring
acceptance checklist in [the desktop README](../../apps/desktop/README.md).
Use the same shared source and gate for ongoing Windows and Linux development.
The Ubuntu 24.04 build baseline does not imply compatibility with older distros.
Native Linux Wayland/X11 behavior, Secret Service failures, offline restart/sync,
clean-machine installation, signing, updates, and installers remain acceptance
work. DESK-005 stays open. No supported Linux release is claimed.

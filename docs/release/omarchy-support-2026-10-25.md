# Omarchy compatibility verification — 2026-10-25

Scope: Linux x64 AppImage/CLI installation and standalone installer prerequisites
on Arch-based Omarchy. No package publication or remote push was performed.

Implemented:
- pacman container setup for Docker/Compose and Podman/Compose.
- pacman Docker Compose repair, followed by an actual Compose capability probe.
- Desktop package checks, conditional runtime installation and post-install checks.
- Arch full-upgrade transactions with normal interactive confirmation.
- No-install behavior and documented Secret Service/Wayland/native-host setup.

Verification commands:
- `cargo fmt --package vaults-installer --check`
- `cargo test -p vaults-installer`: Windows x64, 20 passed.
- `cargo clippy -p vaults-installer --all-targets -- -D warnings`: Windows x64, passed.
- The same installer tests and Clippy run under Ubuntu 24.04 WSL, Linux x64:
  18 tests passed; Clippy passed.
- `git diff --check`: passed.

New tests cover Docker/Podman package selection, full-upgrade arguments, existing
runtime dependencies, disabled installation, installation failure and failed
post-install verification. These use simulated probes and installers; they do
not run pacman or modify the host package database.

Limit: no native Omarchy machine was available. Hyprland GUI, WebKitGTK rendering,
real keyring enrollment/unlock, offline restart/sync, browser connection and
fresh-install/update behavior on Omarchy remain native acceptance gates in
`apps/desktop/README.md`. Ubuntu WSL and unit tests are not Omarchy certification.

References checked:
- https://omarchy.org/manual/other-packages/
- https://v2.tauri.app/start/prerequisites/
- https://archlinux.org/packages/extra/x86_64/docker-compose/
- https://wiki.archlinux.org/title/Podman

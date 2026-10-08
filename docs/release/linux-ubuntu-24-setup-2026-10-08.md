# Ubuntu 24.04 desktop development setup — 2026-10-08

Installed a separate WSL2 distribution named `Ubuntu-24.04` for Linux desktop
development. Its installed release is Ubuntu 24.04.5 LTS. The existing `Ubuntu`
20.04 distribution and Podman distribution were retained.

## Installed environment

- Development user: `vaults-dev`, configured as this distribution's default
  user in `/etc/wsl.conf`. Provisioning uses `wsl -d Ubuntu-24.04 -u root`;
  development and builds run without root.
- Linux checkout: `/home/vaults-dev/projects/127Vaults`, cloned from local Windows
  `main` at `a1f5ee4`. Windows dependencies and build targets are not shared.
- Node.js 24.21.0 from the official Linux x64 archive, checked against the
  official SHA-256 manifest; installed under `/opt/vaults-node24` with command
  links under `/usr/local/bin`.
- pnpm 11.19.0, matching the repository's package-manager pin. Workspace
  dependencies installed with `pnpm install --frozen-lockfile`.
- Rust 1.98.1 through rustup, with rustfmt and Clippy. Cargo environment loaded
  by the development user's shell profile.
- Native packages: `build-essential`, `pkg-config`, `curl`, `wget`, `file`, `git`,
  `libxdo-dev`, `libwebkit2gtk-4.1-dev`, `libssl-dev`, `libsecret-1-dev`,
  `libdbus-1-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`, and `patchelf`.
- GUI/keyring packages: `gnome-keyring`, `dbus-x11`, and `fonts-dejavu-core`.
  Installing GNOME Keyring does not establish an unlocked login keyring.
- Native dependency probes report WebKitGTK 2.52.6 (API 4.1), GTK 3.24.41,
  and libsecret 0.21.4. WSLg exposes X11 display `:0` and Wayland `wayland-0`.
- A `dbus-run-session` probe successfully activated GNOME Keyring and
  introspected `org.freedesktop.Secret.Service`. This verifies service
  availability, not credential storage/unlock behavior.

## Use the environment

From Windows PowerShell:

```powershell
wsl -d Ubuntu-24.04 -u vaults-dev
```

Then in Linux:

```bash
cd ~/projects/127Vaults
git fetch origin
git merge --ff-only origin/main
pnpm install --frozen-lockfile
CARGO_BUILD_JOBS=2 pnpm check:desktop
dbus-run-session -- pnpm --filter @127vaults/desktop dev
```

The clone's `origin` is the local Windows repository. Fetching it brings locally
committed changes into the Linux checkout without a GitHub push. Commit changes
in Windows `main` before fetching; keep Linux edits separately if working there.
The two-job build limit keeps first-build memory use manageable in this WSL VM.

Gate output for this setup is stored at
`/home/vaults-dev/desktop-gate-2026-10-08.log`.

## Verification

The complete `CARGO_BUILD_JOBS=2 pnpm check:desktop` gate passed in the Linux
checkout at `a1f5ee4`: native prerequisite probes, TypeScript/Vite, Cargo check,
11 desktop tests, 37 shared CLI library tests, and the locked Tauri release
build. The initial optimized build took 5 minutes 1 second and produced
`/home/vaults-dev/projects/127Vaults/target/release/vaults-desktop-poc`, an x86-64
Linux ELF executable.

A bounded WSLg startup probe ran the executable without root in a fresh D-Bus
session. It stayed running until `timeout` stopped it at 15 seconds (exit 124).
The log at `/home/vaults-dev/desktop-startup-2026-10-08.log` contains portal,
PipeWire and EGL/Zink graphics warnings. No visual rendering or user flow was
accepted from this process-lifetime probe; investigate the graphics warnings
during GUI verification.

This closes the local Linux desktop compilation blocker. CI has not been run;
GUI acceptance, actual keyring credential persistence, offline restart/sync,
Wayland/X11 drag, installers, signing and clean-machine testing remain pending.

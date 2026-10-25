# Omarchy WSL fixture

This is an unofficial headless Omarchy adaptation with WSLg app windows, built
from the official Arch WSL image and pinned `clarenceb/omarchy-wsl2` sources.
It is useful for Arch package/runtime checks. It does not verify native Omarchy
Hyprland, physical GPU behavior, full disk installation or login keyring unlock.

From Windows PowerShell:

```powershell
.\scripts\ops\prepare-omarchy-wsl.ps1
```

The default distro is `Vaults-Omarchy-Test`; the default work directory is
`$env:USERPROFILE\.127vaults-omarchy-wsl`. Provisioning verifies the official
image's published SHA-256, pins the WSL adaptation commit and Omarchy `v4.0.6`,
and records provenance and logs outside the checkout. It creates a separate
user (`omarchy`, UID 1271) and changes only the new guest. It never unregisters a
distro, changes the default distro or shuts down other guests. Existing names
and paths are refused. `-Resume` explicitly retries a failed recorded fixture;
the adaptation's provisioning stages can reapply that guest's configuration.
The guest is disposable: do not use it for real credentials or vault data.

Use the real packaged-client smoke after provisioning:

```powershell
node tests/internal/desktop/omarchy-wsl-smoke.mjs C:/path/desktop/linux C:/path/cli/linux C:/path/installer/linux C:/path/new-evidence-directory
```

The three input folders must be complete, checksum-verified Linux releases.
The evidence directory must be new and outside the checkout. The smoke installs
runtime packages and Mesa in this test guest, checks standalone CLI/installer
startup, native-host framing and isolated Secret Service store/read/delete,
then exercises AppImage unlock/setup screens through the real WSLg webview in
both direct and extract-and-run modes. It does not enroll accounts or verify
offline sync or browser connection end to end. Profiles stay in unique guest
directories; logs and source/package provenance stay in the evidence directory.

The old CLI 2.11 AppImage bundler can include an older Wayland client library
that prevents newer Arch Mesa drivers from loading (`wl_fixes_interface` is
missing; WebKit reports `EGL_BAD_PARAMETER`). It also exposes GStreamer plugin
compatibility warnings. The desktop build uses Tauri CLI 2.12.4 for its upstream
display-library bundler fixes. Build candidates with the existing `release.ps1` workflow and
keep them internal until verification and coordinated publication are complete.

## Verified run: 2026-10-25

`Vaults-Omarchy-Test` booted successfully on WSL 2.7.11 / WSLg 1.0.73.2.
The official base image was `archlinux-2026.10.01.179549.wsl`, SHA-256
`d2ef183f58cd65bfce52d5a122fe4936f7f2ac0af6b1b427681afd28d1f64b17`.
The adaptation revision was `f90ccb1f427f10b1e2ff80738a89acd32d19b0cd`;
Omarchy tag `v4.0.6` resolved to `237f1b4071a0bff2296c6d740ba2b9fd695ebfa0`.
Its upstream version file says `4.0.0.alpha`; the Git tag/commit identify the
tested source. Installed runtime versions included Mesa 26.2.5, Wayland 1.26.0,
WebKitGTK 2.54.2 and GNOME Keyring 51.1. Optional Omarchy launcher packages were
unavailable during provisioning; this is a headless adaptation with Omarchy's
configuration and tools plus the 127Vaults runtime, not a complete Hyprland desktop.

The released 0.1.16 desktop failed with `EGL_BAD_PARAMETER`. Loader diagnostics
showed host `libEGL_mesa.so.0` could not resolve `wl_fixes_interface` from the
bundled Wayland library. Renderer environment switches did not correct it.

An internal desktop 0.1.17 candidate from source
`fa35f6cabd3e367898fd785b5b84c2c6298850f4`, built with the existing
`release.ps1 desktop -Platform linux` workflow and Tauri CLI 2.12.4, passed:

- All release gates: desktop types/native compile, 47 desktop tests, 121 Rust
  client tests (one unrelated live-fixture test ignored), packaging and native
  host framing.
- Omarchy WSLg: direct AppImage and extract-and-run both rendered the unlock
  screen and navigated to private-server setup with an empty server URL.
  No library preloads, software-rendering flags or sandbox overrides were used.
- Released CLI and installer 0.1.16 startup, standalone native-host framing and
  empty-source discovery, plus disposable Secret Service store/read/delete.
- The Ubuntu-built installer source test binaries also ran in this guest:
  18 passed, including the new pacman prerequisite tests. These test package
  selection/failure handling with injected probes, not real engine installation.

Receipts remain under `C:/Users/shubh/.127vaults-omarchy-wsl`: `provenance.json`,
`provision.log`, `boot.log`, `source-installer*-tests.log` and
`smoke-03/evidence.json` with the UI transcripts and per-step logs.
Failed-run evidence is retained in `smoke-01` and `smoke-02`.
The candidate is under `candidate-release/desktop/0.1.17/linux`; it was not
published. Current builds still emit WSL graphics fallback and missing GStreamer
`appsink` warnings; media playback was not tested. Account enrollment, offline
sync, live browser connection, native Hyprland and login keyring unlocking remain
outside this smoke's acceptance scope.

References:
- https://omarchy.org/manual/getting-started/
- https://github.com/clarenceb/omarchy-wsl2
- https://github.com/tauri-apps/tauri/pull/16062
- https://learn.microsoft.com/windows/wsl/use-custom-distro

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
compatibility issues. The desktop build uses Tauri CLI 2.12.4 for its upstream
bundler fixes. Build candidates with the existing `release.ps1` workflow and
keep them internal until verification and coordinated publication are complete.

References:
- https://omarchy.org/manual/getting-started/
- https://github.com/clarenceb/omarchy-wsl2
- https://github.com/tauri-apps/tauri/pull/16062
- https://learn.microsoft.com/windows/wsl/use-custom-distro

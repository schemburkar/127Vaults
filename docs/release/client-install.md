# Install the private 127Vaults clients

This package contains the desktop app, CLI and browser native host for its named
OS/architecture. Binaries are unsigned;
check the sender's SHA256SUMS. LICENSE.md and COMMERCIAL-LICENSE.md contain the
adopted terms; testing requires applicable written authorization. No automatic
updater is enabled.

Windows: install the accompanying setup EXE. If your handoff also includes a
legacy portable client ZIP, extract it to a stable, user-owned directory and run `vaults-desktop-poc.exe`.
Install Microsoft WebView2 if it is absent; the setup EXE can download it.
`127vaults.exe --help` lists CLI commands.

Ubuntu 24.04 x64: install the accompanying Debian package with
`sudo apt install ./127vaults-desktop-<version>-linux-x64.deb` (substitute the supplied
filename), or run the AppImage. For an optional legacy portable client TAR.GZ,
install WebKitGTK 4.1, libsecret and a desktop Secret
Service, then execute `./vaults-desktop-poc`. Run `./127vaults --help` for CLI use.
Keep the portable executables together so desktop can start its connector agent.
The independent desktop release contains installers; obtain the separate CLI
release for standalone CLI use or a native host outside the AppImage mount.

Desktop enrollment needs your server's HTTPS address and verified CA trust.
The desktop/CLI keep an encrypted local replica after enrollment and sync.
The browser extension ZIP is separate. Load it unpacked and copy its extension
ID from the browser extensions page, then register the native host:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-native-host.ps1 -ExtensionIds <ID> -HostBinary .\127vaults-extension-host.exe
```

For installed Windows desktop, use the script and host in the app's installation
directory (normally `%LOCALAPPDATA%\127Vaults Desktop` for NSIS). On Linux:

```sh
bash install-native-host.sh /absolute/path/127vaults-extension-host <ID>
```

For Debian installations the host is `/usr/bin/127vaults-extension-host`.
For AppImage use the separately downloaded CLI package's host in a stable extracted directory for
native registration; the browser cannot launch an executable inside a transient
AppImage mount. The desktop's own connector sidecar is still embedded.
Registration is current-user only. Rerun after moving the host or changing IDs.
Chrome, Chromium and Edge user manifest locations are registered on Linux.
The Linux registration script needs Python 3. Flatpak/sandboxed browsers need
separate native messaging integration and are not covered by this script.

To disconnect on Windows remove the current-user
`Software\Google\Chrome\NativeMessagingHosts\com.127vaults.connector` and/or
`Software\Microsoft\Edge\NativeMessagingHosts\com.127vaults.connector` registry
keys. On Linux delete only `com.127vaults.connector.json` under the browser's
`~/.config/<browser>/NativeMessagingHosts` directory. Removing clients does not
delete enrolled profiles or server data. Preserve any data before manual cleanup.

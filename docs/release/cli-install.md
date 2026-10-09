# Install the private-test CLI

Extract the archive to a stable user-owned directory. It contains the CLI,
browser native host and the registration script for your platform. It does not
contain the desktop app. Run `127vaults.exe --help` on Windows, or
`./127vaults --help` on Linux. No Node, pnpm or Rust compiler is needed to run it.

Enrol against the server's HTTPS address after verifying the server CA. Use
fictitious credentials for these experimental builds. An enrolled and synced
profile keeps an encrypted local replica for offline access.

For the separately downloaded Chrome/Edge extension, load its extracted folder
unpacked, copy its ID from the extensions page, and register this archive's host:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-native-host.ps1 -ExtensionIds <ID> -HostBinary .\127vaults-extension-host.exe
```

```sh
bash install-native-host.sh /absolute/path/127vaults-extension-host <ID>
```

Keep the host at the registered path. Linux registration requires Python 3 and
covers Chrome, Chromium and Edge user configuration directories. Sandboxed
browsers need separate native messaging integration. The extension is a
separate product; downloading this archive does not install it.

These builds are unsigned and have no automatic updater. Verify the sender's
checksums and read the accompanying license policy; that policy is not a public
release license. Replacing client executables does not delete enrolled profiles.

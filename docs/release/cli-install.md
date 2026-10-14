# Install the private-test CLI

Extract the archive to a stable user-owned directory. It contains the CLI,
browser native host and the registration script for your platform. It does not
contain the desktop app. Run `127vaults.exe --help` on Windows, or
`./127vaults --help` on Linux. No Node, pnpm or Rust compiler is needed to run it.

Enrol against the server's HTTPS address after verifying the server CA. Use
fictitious credentials for these experimental builds. An enrolled and synced
profile keeps an encrypted local replica for offline access.

After online login, `127vaults device list` lists this account's trusted devices.
`device inspect CODE` reviews a pending enrollment. An enrolled CLI can approve
another client's request with `device approve CODE --device-id UUID --fingerprint
SHA256` after comparing its full UUID and signing-key fingerprint directly with
the requesting client. Approve and `device revoke UUID` require confirmation;
`--yes` is the explicit automation option. They return JSON and use the selected
CLI profile (`--config-dir PATH` when needed). The current device cannot revoke
itself. Revocation affects online trust and sessions; it does not remotely erase
an offline replica. These commands require an online unlocked CLI agent.

`127vaults sync-review` lists queued item titles, operation identifiers and changed
field names, with separate settings pending/conflict flags. It reads the durable
local queue without uploading changes or printing usernames, websites, passwords
or custom-field values. Use `sync` to retry, or `conflict compare` to review a
confirmed conflict with secret values redacted before choosing a resolution.
All these commands accept `--config-dir PATH` and require an unlocked CLI agent.

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

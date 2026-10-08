# Local packaging evidence — 2026-10-08

Prepared a complete private test handoff without GitHub, a registry, or a push.
Final handoff location:

`C:\127Vaults-Packages\127vaults-private-test-0.1.0.zip`

The extracted directory beside it contains all individual artifacts, recipient
instructions, a standalone Node verifier, `SHA256SUMS`, `manifest.json` and
`builds.json`. The external `.zip.sha256` checks the whole transport archive.
Version 0.1.0 identifies an unsigned private-test build; no public catalogue
entry, signing key, publisher signature or release license was fabricated.

## Contents

- Windows x64 NSIS desktop setup EXE, including CLI and native messaging host.
- Windows portable desktop/CLI/native-host ZIP.
- Ubuntu 24.04 x64 desktop Debian installer and AppImage.
- Linux portable desktop/CLI/native-host TAR.GZ.
- Chrome/Edge unpacked Manifest V3 extension ZIP.
- Offline Linux amd64 server/web/PostgreSQL/OpenSSL image TAR with Compose,
  operator commands, Windows/Linux installer launchers, and a hash manifest.

The native build manifests record `f194fbc3151720e39c7ebb03b7facac0b489c7ea` and
`sourceDirty: true`. Windows recorded changes present in the shared checkout;
Linux retained a previously generated untracked schema. These are development
artifacts with file integrity evidence, not reproducible signed releases.
Later packaging-tool commits and other concurrent application work are not
claimed as the binary build revision. Per-build provenance is in `builds.json`.

## Checks performed

- `pnpm check` passed: workspace syntax/types, desktop Cargo check, frontend
  builds and API contracts.
- `pnpm test` passed, and packaging/installer tests passed after changes to the
  packaging tools. Tests cover tampered files, mandatory manifest entries, path
  traversal, extension packaging contents, matching assembly revisions and ZIP
  handoff checksums.
- `cargo test --locked -p vaults-cli --lib`: 38 passed.
- Windows NSIS silent install returned 0 and installed all three executables
  plus both registration scripts. Installed native host passed framed source
  discovery. Silent uninstall returned 0.
- Ubuntu Debian installation with `apt-get install` passed. Installed CLI help
  and native-host framed source discovery passed; `ldd` reported no missing
  desktop libraries. Linux native registration wrote valid Chrome, Chromium and
  Edge manifests under an isolated `XDG_CONFIG_HOME`, preserving actual browser
  registrations.
- AppImage ran non-root under `dbus-run-session` with extract-and-run enabled
  until a 12-second timeout (exit 124). Portal/EGL warnings were logged. This is
  startup/process evidence, not visual or enrolled-client acceptance.
- Fresh server setup through the extracted PowerShell launcher created an
  isolated private identity and Compose project. PostgreSQL and server were
  healthy. HTTPS `/health/live`, authenticated `/health/ready`, `/` and
  `/app/passkeys.mjs` returned 200 using the installation CA.
- An existing host Node process already occupied port 12780. It was preserved.
  For the transport probe only, the test project's publication was moved to
  12782 and requests used the server's configured `Host: 127.0.0.1:12780`.
  Recipients must have the default 12780 free; arbitrary external-port browser
  operation was not accepted by this probe.
- Test server was stopped without deleting its database volume or private
  identity. Existing acceptance containers were retained. Ubuntu desktop
  package and build prerequisites remain installed for subsequent development.
- Package manifests and the final ZIP checksum were verified. Server archives
  were created before any test `.env` or private identity was introduced; the
  handoff contains neither those files nor enrolled local profiles.

## Build issues resolved and remaining limits

The container build omitted the passkey module used by shared UI and the legacy
web client. Both build and runtime stages now copy it. WASM generation now
regenerates Node authentication bindings alongside web bindings.

WiX's `candle.exe` could not start on this Windows host. The standard Windows
package is the successfully installed NSIS setup EXE; MSI is not shipped.
Linux AppImage helper download timed out once and was retried through its
official download. AppImage packaging also needed `xdg-utils`, now documented.

Native Linux **server** installation has not been accepted on a clean host;
rootless/rootful UID and secret-mount permissions remain a matrix check. Docker
runtime installation is also unverified. Windows Podman was rehearsed, and
Linux desktop installation was rehearsed on this existing Ubuntu 24.04 WSL
environment. New-machine owner enrollment, browser/native-host integration,
keyring persistence, backup/restore, native Linux GUI behavior, signing,
release-specific license terms, store distribution and public release gates
remain separate acceptance work. See local-packaging.md for exact build and
recipient commands.

# Local private test packages

Build native packages locally without GitHub or a registry. Version 0.1.0 is a
private test build, unsigned, for supervised tests with fictitious data. The
public release catalogue stays empty until signed releases and release license
terms are ready. LICENSE-POLICY.md records the policy, not a release license.

## Build

From the repository root, after `pnpm install --frozen-lockfile`:

```powershell
pnpm package:local --out C:\127Vaults-Packages\windows-0.1.0
```

This builds a Windows NSIS setup EXE, a portable desktop/CLI/native-host ZIP,
the Chrome/Edge extension ZIP, and an offline server TAR containing the web app,
PostgreSQL and TLS helper images. Requires the pinned Rust/WASM generator,
Node 24, pnpm, Windows C++ build tools and a running Podman engine (or `--docker`).
Output must be a new directory outside the checkout. A failed build exits nonzero
and does not write a success manifest; use a new output directory when retrying.

On Ubuntu 24.04 x64 with the desktop native dependencies installed:

```sh
CARGO_BUILD_JOBS=2 pnpm package:local --out /home/you/127vaults-packages/linux-0.1.0 --components desktop
```

This builds a Debian package, AppImage and portable desktop/CLI/native-host TAR.GZ.
Linux packaging also needs `zip` when including the extension.
AppImage packaging needs `xdg-utils` (`sudo apt install xdg-utils`). The server TAR
built on Windows already contains Linux amd64 containers and can be shared with
both Windows x64 and Linux x64 recipients; it does not need rebuilding in WSL.
Use `--components server,extension` or `--components desktop` to build a subset.
Linux binaries built on Ubuntu 24.04 target that baseline; older distributions,
ARM64 and macOS are not covered by these packages.
Native Linux server installation still needs a clean-host permission and
container-engine acceptance run; the server runtime rehearsal recorded for this
handoff used Windows Podman. Treat Linux server commands as a test candidate.

Copy the Linux output back to the Windows machine and collect all matching
builds into a single handoff directory. The assembler verifies each input and
refuses mixed source revisions or conflicting files:

```powershell
pnpm package:assemble --out C:\127Vaults-Packages\handoff-0.1.0 --from C:\127Vaults-Packages\windows-0.1.0 --from C:\127Vaults-Packages\linux-0.1.0 --zip
```

Transfer the resulting directory; the server is one TAR, desktop installers and
portable client archives are separate files, and the extension is one ZIP.
`--zip` also produces a single ZIP containing the complete handoff plus an
external `.zip.sha256` file for checking it before extraction.

Every completed output has `manifest.json`, `SHA256SUMS`, file sizes, source
revision and dirty-tree state. Verify before transfer and after receipt:

```sh
node scripts/release/verify.mjs /path/to/package-directory
```

The assembled handoff includes a standalone `verify.mjs`; recipients can run
`node verify.mjs .` from the extracted handoff without a repository checkout.

Keep package contents together. Compare SHA256SUMS with a copy received directly
from the sender. Hashes detect corruption; these unsigned builds have no public
publisher signature. Native installers include both the CLI and browser host;
recipients do not need Rust, pnpm or source files. Browser IDs are chosen by the
recipient's unpacked extension, so native-host registration is an explicit
per-user step rather than an installer binding to a fabricated store ID.

## Recipient commands

Server: extract `127vaults-server-0.1.0-linux-amd64.tar.gz`, enter its directory,
install Node.js 24 and a container engine with Compose, then:

```powershell
.\install.ps1 doctor
.\install.ps1 setup --endpoint 127.0.0.1
.\install.ps1 bootstrap
```

Windows Podman automatically discovers `podman-compose.exe` on PATH, or pass
`--compose-provider C:\full\path\podman-compose.exe`. For Docker, add `--docker`
to each command. On Linux use `bash install.sh` in place of `.\install.ps1`.
`setup` preserves an existing identity and starts the stack. `verify` checks files
without contacting the engine; `doctor` checks prerequisites before setup.
`doctor --json` emits a redacted report suitable for operator handoff. The check
distinguishes a missing engine from a stopped/unreachable engine and a missing
or stalled Compose provider; external probes time out after 15 seconds each.
It also inspects an existing identity without reading key contents or modifying
files. Setup/start refuse incomplete identity files and conflicting endpoint or
private-directory options. See the server test-install runbook for recovery
guidance and the checks that still require target-host acceptance.
Use `status`, `start`, `stop` and `bootstrap` through the same launcher. The
server runs under the container engine and restarts with it; this does not install
a second OS service. See server-test-install.md in the repository (README.md in
the extracted server bundle) for CA trust, licensing, backups and recovery.

Desktop: run the Windows setup EXE (current-user installation), or on
Ubuntu run `sudo apt install ./127vaults-desktop-0.1.0-linux-x64.deb`.
Windows setup can download WebView2 when absent, so that prerequisite needs
internet access. Linux installs WebKitGTK and native runtime dependencies from
the distribution. AppImage: `chmod +x *.AppImage` then execute; where FUSE is
unavailable use `APPIMAGE_EXTRACT_AND_RUN=1 ./127vaults-desktop-0.1.0-linux-x64.AppImage`.
GNOME Keyring or an equivalent Secret Service must be available and unlocked
for remembered account secrets. Portable clients require the same OS runtimes.
The web app is served by the installed server, not a separate client download.

Extension: extract the extension ZIP and load its `127vaults-extension` folder
from Chrome/Edge's extensions page with Developer mode enabled. See its README
for connecting the packaged native host. There is no Chrome/Edge store release
or automatic update mechanism in this private handoff.

Prerequisite downloads: https://nodejs.org/en/download,
https://podman.io/docs/installation, https://docs.docker.com/get-started/get-docker/.
Install the engine and Compose before `doctor`; on Windows start the Podman
machine or Docker Desktop first. The server image archives carry application,
database and certificate dependencies, but not the host's container engine.

## Later public distribution

Upload the tested native installers, client archives, extension package and
server bundle as immutable GitHub Release assets when the repository is hosted.
Keep CI artifacts for development builds. A public release needs signatures,
fixed release license terms, compatibility metadata and clean-machine acceptance.
Populate public-website/releases.json only with real HTTPS asset URLs and that
metadata. Its validator and download cards now support Linux desktop too.

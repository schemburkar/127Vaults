# 127Vaults installer

`127vaults-install` is a standalone Rust app with its own version, independent of downloaded server and client versions. Component selection happens before prerequisite work. No Rust, Node, pnpm or checkout is needed to start it.

Download the Installer archive for Windows x64 or Linux x64 from the private trial page, verify its displayed SHA-256, and extract it. The page provides a command containing the existing invitation credential. That command is private. Alternatively set `VAULTS_INSTALL_INVITATION` in the process environment, or run interactively and paste the URL into the hidden prompt to avoid shell history. The installer never persists the invitation or places its bearer in HTTP URLs.

```powershell
.\127vaults-install.exe
.\127vaults-install.exe --components server,desktop,extension,pwa --plan
.\127vaults-install.exe --components server --yes
```

```sh
./127vaults-install
./127vaults-install --components cli,extension --yes
./127vaults-install --components pwa --server-url https://your-private-server
```

Use `--directory PATH` to choose the installation state/package location. Keep it stable: later runs fetch the current entitled catalogue, compare artifact digests, and detect the recorded installations. The default is the operating system's local data folder under `127Vaults/installer`. A lock excludes concurrent installers. A stale lock requires inspecting the interrupted operation before manually removing it. State is atomically saved after each component; a failed initial server setup can resume from its recorded bundle. A half-completed server upgrade preserves both bundles and the prior receipt and requires inspection before retrying. No database volume or private identity is deleted.

The API uses the existing invitation's authentication, entitlement, pinned issuer, major-version routing and expiry rules. It does not create a new trial on download or upgrade. Fresh activation uses the UUID reported by the running server; reactivation of the same UUID returns the existing signed license. Licenses for other UUIDs require the existing approved replacement process.

## Prerequisites

Only server selection requires Node 24 and a container engine. Existing reachable Podman or Docker is reused; select explicitly with `--engine podman|docker`. An existing Node 24 is reused. Otherwise a private Node 24 runtime is downloaded from nodejs.org, checked against its HTTPS SHA-256 manifest, and extracted without changing the system Node installation.

Missing engines can be installed with WinGet on Windows, apt on Ubuntu (Docker or Podman), or dnf on Fedora (Podman). These operations can require the operating system's elevation prompt, sudo, engine startup, session refresh or reboot. The installer stops with the exact next step when the engine is unreachable; it does not choose, create, or switch an existing Podman machine or alter Docker socket permissions. Unsupported distributions require installing the engine manually. Ubuntu's Docker package names are `docker.io` and `docker-compose-v2`; other apt distributions may need manual setup. Missing Podman Compose can be installed as a private native binary from Docker's GitHub release, verified against the release's SHA-256 digest. `--compose-provider PATH` selects an existing Podman Compose binary. Docker Desktop supplies its own Compose. The bundle's doctor verifies engine access and Compose capabilities before server setup. `--no-install-prerequisites` disables automatic prerequisite installation.

For fresh network configuration use `--endpoint PRIVATE-IPV4` or `--tailscale`. Upgrades preserve the existing network and private identity. Tailscale must already be installed and signed in. The prerequisite check verifies the local Tailscale identity before setup starts. Existing installations accept rerunning the same network settings but reject a changed endpoint or switching to Tailscale during a normal upgrade. The installer uses the existing protected server operator for setup, license verification and startup. CA trust and owner bootstrap remain local verification steps.

Desktop uses the native Windows installer or installs an executable Linux AppImage at a stable launcher path. macOS server/installer distribution is not yet packaged. Extension packages are staged in a durable folder. Setup guides browser approval, asks for the extension ID, finds the installed Desktop/CLI connector (or asks for its executable), and registers the IDs. Windows setup runs registration through a separate Windows management process, outside the caller’s inherited registry view, and checks registry and manifest contents there. Interactive setup asks the user to confirm that the popup detects the unlocked client before marking the extension complete. CLI packages are extracted, with their path and native-host registration instructions. Updates retain CLI/extension folder paths and the approved native-host manifest; previous folders are retained for recovery. PWA uses the server's existing web assets, requires HTTPS and CA trust, and completes through the browser's Install app action. Client-only installs do not require Node or containers. Desktop account enrollment and vault credentials are handled by the clients.

For unattended extension setup, provide `--extension-ids ID` (comma-separated for Chrome and Edge) and optionally `--extension-host PATH`. `--yes` does not waive connector setup. Missing IDs, failed registration, or a declined connection confirmation leave the extension incomplete and its files in place for a later retry. Setup also runs for an already-current extension, including receipts from older installers that marked extraction alone complete. Unattended registration does not establish that a running browser is connected; verify its popup separately.

## Existing servers and upgrades

For a server installed outside this app, adopt its initialized bundle on the first run:

```sh
./127vaults-install --components server --from /existing/server \
  --engine podman --backup-dir /protected/new-upgrade-backup \
  --backup-key-file /separate/existing-32-byte-key
```

Subsequent updates omit `--from`, and supply a new `--backup-dir` and the existing `--backup-key-file` when a new server artifact is offered. The existing upgrader stops writes, makes and rehearses an encrypted backup, preserves identity/configuration/license, starts the new bundle, and checks identity/schema/users/license. It currently supports schema 8. An initial adoption compares against an unknown artifact digest and therefore performs a verified upgrade even if the operator believes the payload is already current.

## Build and server policy

```powershell
cargo test --locked -p vaults-installer
cargo clippy --locked -p vaults-installer --all-targets -- -D warnings
.\release.ps1 installer -Platform both -Label installer-test
```

Combined releases use the coordinated version selected by `release-set.ps1` for every product, including the installer. The packaged installer executable and metadata must report that same version; `apps/installer/Cargo.toml` remains the development default. Add verified installer release directories to the trial catalogue input alongside the existing products. Builds stay internal until the complete combined release is accepted and published. Do not publish intermediate installers or client/server builds separately.

The authenticated `GET /api/trials/:id/installer` endpoint returns protocol 1, installation binding, entitled artifacts and `minimumInstallerVersion`. It does not expose R2 keys or bearer credentials. Installer requests include `X-127Vaults-Installer-Version` and use the existing bearer header. Configure `minimumInstallerVersion` in the Cloudflare deployment config (default `0.1.0`) to retire old installers. An authenticated installer below that floor receives HTTP 426 on plan, download and activation requests. Missing/invalid versions on the installer endpoint are also rejected. Browser flows remain available; this is a compatibility floor, not a replacement authentication boundary. Invalid operator policy fails closed.

The prompt design draws on [cliclack / Clack](https://docs.rs/cliclack/0.5.6/cliclack/) and argument parsing uses [clap](https://docs.rs/clap/4.6.1/clap/).

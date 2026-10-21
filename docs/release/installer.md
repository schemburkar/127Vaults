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

Installer 0.1.8 discovers running 127Vaults installations publishing port 12780
through Podman/Docker before selecting fresh setup. It verifies the Compose project
against the initialized bundle and offers the existing server as a guarded upgrade.
An incomplete separate setup is retained in the installer receipt and on disk.
Multiple published installations or a conflicting completed receipt require explicit
selection/recovery; an occupied port never causes an automatic IP/port change.
`127vaults-install --discover` lists these candidates without an invitation or writes.
Stopped/unpublished servers can be adopted explicitly with `--from`.

Fresh setup checks port availability before initialization and gives each new
installation a separate private identity directory under the installer state root.
An already-bound invitation must match the selected installation before an upgrade
starts. Normal upgrades preserve identity, data, CA, licenses, admin credentials and
trial expiry. Installer 0.1.10 automatically manages the backup key and a new
backup directory; explicit backup path options remain available.

## Automatic backup onboarding (0.1.10)

Fresh server setup generates a random backup encryption key and shows its full
path, backup folder and saved settings. Defaults are under the current user's home:

```text
~/.127vaults/keys/<server-project>.key
~/.127vaults/backups/<server-project>/
~/.127vaults/installations/<server-project>/recovery.json
```

On Windows `~` is normally `C:\Users\<username>`. Keys are protected by owner-only
Unix permissions or a restricted Windows ACL. The recovery JSON stores locations,
not key contents or invitation credentials. Keep a separate safe copy of the key;
the same disk's copy alone is not off-machine recovery. Updates reuse the saved key
and choose a new backup folder automatically. The plan shows those paths before
confirmation. Lost saved keys are never silently regenerated.

Existing installations without saved backup settings are onboarded on the next
installer run; a newly generated key protects future backups, not older archives.
Older backups still require their original key. To retain a known manual key,
provide `--backup-key-file PATH` once; its location is saved. `--backup-dir` can
override the next backup destination. The standalone server setup has equivalent
onboarding in the next server bundle. For an already installed older server, the
source operator helper is `node deploy/recovery.mjs --directory <initialized-bundle>`.

Extension setup selects the newest installed native connector by its companion
CLI version, checks it meets the extension package version, displays the selection,
and replaces browser registration. On Windows it closes ports to the previously
registered binary when the path changes. A stale CLI receipt must not downgrade
a newer Desktop connector. Read-only site matching can be checked with
`node scripts/release/smoke-native-host.mjs <host> --site-origin https://vercel.com
--source desktop --expect-count 1 --receipt <new-private-receipt.json>`; no password
is retrieved.

The local 0.1.8 installer continues to obtain deployables from the current entitled
Cloudflare catalogue (currently 0.1.7); its version does not select matching component
versions. It does not alter published package manifests or downloaded server helpers.
`--hostname` is available for future DNS-capable server bundles and is refused for
the unchanged 0.1.7 server. See the server runbook for the prepared private-CA DNS mode.

Installer 0.1.9 also supports `--keep-existing-license` for an already licensed
server. Package downloads still require a valid entitled invitation, but its
activation binding is independent of the existing server's license. Setup verifies
the running server's active license against its local installation identity before
planning and verifies that identity, plan, expiry and seat limit again afterward.
It does not call trial activation, download/install a trial license, reset expiry,
or change either installation's binding. This option cannot initialize an unlicensed
server. Interactive setup offers it when the download invitation belongs to another
installation; unattended use must opt in explicitly. Directly issued development
licenses have no invitation link of their own.

For example, reuse the approved package-access invitation with
`127vaults-install --components server --keep-existing-license --plan` first.
Remove `--plan` for the guarded update. From 0.1.10 the saved recovery settings
supply the key and a new backup directory automatically. The packaged smoke script accepts
`--check-existing-license-plan` with `VAULTS_INSTALL_INVITATION` in the process
environment to verify this path without performing an update or activation.

For a server installed outside this app, adopt its initialized bundle on the first run:

```sh
./127vaults-install --components server --from /existing/server \
  --engine podman --backup-dir /protected/new-upgrade-backup \
  --backup-key-file /separate/existing-32-byte-key
```

Subsequent updates omit `--from` and reuse the saved recovery settings; backup path
flags are optional overrides. The existing upgrader stops writes, makes and rehearses
an encrypted backup, preserves identity/configuration/license, starts the new bundle,
and checks identity/schema/users/license. It supports schema 8 and 9. An initial
adoption compares against an unknown artifact digest and therefore performs a verified
upgrade even if the operator believes the payload is already current.

## Build and server policy

```powershell
cargo test --locked -p vaults-installer
cargo clippy --locked -p vaults-installer --all-targets -- -D warnings
.\release.ps1 installer -Platform both -Label installer-test
```

For the local Windows 0.1.8 installer against the unchanged live catalogue:

```powershell
.\release.ps1 installer -Platform windows -Version 0.1.8 -Label installer-discovery-dns-20261021
```

The release script checks the executable's embedded version and retains its
manifest and verification receipt under the normal versioned releases directory.
To extract the verified consumer archive for local testing and check read-only
server discovery, run `node scripts/release/smoke-installer.mjs --release <release-directory>
--extract-to <new-directory-outside-release> --output <new-private-receipt.json>`.
The extracted installer remains available for the human install/update test;
this command never performs that update or changes trial activation.

Combined releases use the coordinated version selected by `release-set.ps1` for every product, including the installer. The packaged installer executable and metadata must report that same version; `apps/installer/Cargo.toml` remains the development default. Add verified installer release directories to the trial catalogue input alongside the existing products. Builds stay internal until the complete combined release is accepted and published. Do not publish intermediate installers or client/server builds separately.

Use `release-set.ps1 build -Label NAME`, followed by `release-set.ps1 publish -Label NAME`.
If deployment succeeds but live download verification is interrupted, resume with
`release-set.ps1 verify -Label NAME`. This rechecks the tested packages and upgrade
evidence, confirms the saved Cloudflare target, verifies live authenticated downloads
and their checksum, and writes the publication receipts only after success. It
does not upload packages, provision resources or deploy the Worker again.

The authenticated `GET /api/trials/:id/installer` endpoint returns protocol 1, installation binding, entitled artifacts and `minimumInstallerVersion`. It does not expose R2 keys or bearer credentials. Installer requests include `X-127Vaults-Installer-Version` and use the existing bearer header. Configure `minimumInstallerVersion` in the Cloudflare deployment config (default `0.1.0`) to retire old installers. An authenticated installer below that floor receives HTTP 426 on plan, download and activation requests. Missing/invalid versions on the installer endpoint are also rejected. Browser flows remain available; this is a compatibility floor, not a replacement authentication boundary. Invalid operator policy fails closed.

The prompt design draws on [cliclack / Clack](https://docs.rs/cliclack/0.5.6/cliclack/) and argument parsing uses [clap](https://docs.rs/clap/4.6.1/clap/).

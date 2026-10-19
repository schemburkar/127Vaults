# Local independent releases

## Complete installer set and Cloudflare publication

From the Windows build host, use these two commands:

```powershell
.\release-set.ps1 build
.\release-set.ps1 publish
```

`build` pins committed HEAD, increments each component's patch version from the
active private catalogue, and prepares server/web/admin, Windows/Linux desktop,
Windows/Linux CLI and the Chromium extension. It runs the existing product gates,
website/Cloudflare tests, checks the adopted agreements inside every package, and
rehearses an isolated server upgrade from the active package plus backup/restore
and signed-license preservation. Existing installations are left running. A set
becomes publishable only after all required checks pass.

`publish` selects the last successfully tested set, rechecks its hashes and
acceptance evidence, backs up D1, compiles a Cloudflare dry-run, checks the existing
resources and bucket privacy, applies pending D1 migrations, uploads every
artifact to private R2 and verifies the remote SHA-256 values. It activates one
complete catalogue, verifies protected download access and hashes the full server
download through the live website. Only then does it update the local default
deployment configuration. Existing releases and rollback inputs are preserved.
This also publishes the committed public website and Worker; changing those
sources after the build requires building a new tested set.

Both commands support `-Plan` for a preview without builds or remote changes.
Use `-Label lowercase-name` on `build` to choose a stable name; retry the same
label and `-Ref` after a failure to reuse completed, verified outputs. A changed
revision, version or baseline requires a new label. `publish -Label name` selects
a specific tested set. Use `-Help` for the short command reference.

Defaults reuse `.cloudflare-deploy/config.json`, the existing issuer and R2
credentials, `C:\Projects\127Vaults-Releases` (relative to this repository's
parent), the user's release cache, Ubuntu-24.04 WSL, native Docker Compose
connected to the selected Podman machine, and 7-Zip. Windows/Linux build tools,
Node 24, the pinned pnpm/Rust/WASM tools, WSL Python/dpkg-deb and an authenticated
Cloudflare CLI must already be installed. Native Compose must support
`compose ls --format json`; the legacy Python provider is insufficient.

Optional overrides live in the ignored `.cloudflare-deploy/release-set.json`:

```json
{
  "deploymentConfig": "config.json",
  "wslDistro": "Ubuntu-24.04",
  "port": 12935,
  "versions": { "server": "0.0.6", "desktop": "0.0.5", "cli": "0.0.4", "extension": "0.1.3" }
}
```

Omit `versions` for automatic patch increments. Other optional fields are
`outputRoot`, `cacheRoot`, `wslUser`, `linuxCacheRoot`, `composeProvider`,
`sevenZip` and `r2CredentialsFile`; Windows paths in JSON need escaped backslashes
or forward slashes. Relative paths resolve against that private settings file.
Upload credentials default to `secrets/r2-upload.json` under the active deployment
secret directory, or `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` in the environment.
Keys are preserved and never included in packages. The workflow targets the
existing Cloudflare deployment; first-time provisioning remains a separate step.

Older-major catalogue routes are preserved for existing approved downloads.
Build requests, catalogue, test evidence, delivery verification and rollback
configuration live in `<cacheRoot>/sets/<label>`, with a private pointer beside
the settings file. No per-release Markdown receipt is added to the repository.
These commands do not push Git refs.

## Individual products

`release.ps1` prepares one product at a time. It does not publish, push, create
GitHub releases or install a runner. The Node engine underneath it can be called
by future CI without duplicating the build logic. Web assets continue to ship
inside the server image; `web` reports that restriction instead of pretending to
produce an independently deployable web release.

## Commands

From a PowerShell terminal at the repository root:

```powershell
.\release.ps1 -Help
.\release.ps1 extension -Plan -Label friends-a
.\release.ps1 desktop -Doctor -Platform windows
.\release.ps1 extension -Label friends-a
.\release.ps1 cli -Platform windows -Label friends-a
.\release.ps1 desktop -Platform both -WslDistro Ubuntu-24.04 -WslUser vaults-dev -Label friends-a
.\release.ps1 server -Label friends-a
```

The default source is committed `HEAD`. Commit the application work you intend
to distribute, then select that commit explicitly when needed:

```powershell
.\release.ps1 desktop -Ref <commit-or-tag> -Platform windows -Label desktop-test-b
```

Uncommitted files are excluded and never modified or committed by the release
command. A build extracts a fresh Git archive at the resolved commit, so later
commits and edits in other chats cannot enter that build. Exported snapshots
and stage files stay in the release cache, not the development checkout.

`-Plan` reads Git metadata and prints inputs, fingerprint, version and intended
outputs; it creates no build/output directories. `-Doctor` checks tools and
native prerequisites. Checks run by default on every cache miss; there is no
skip-checks option in this first pass.

## Labels and versions

The project's eventual numbering and naming convention remains undecided.
`-Label` is a safe, opaque build name such as `friends-a`. If omitted, the tool
generates a unique commit/timestamp label. Labels are not interpreted as semantic
versions, tags or compatibility claims.

`-Version` is optional **numeric package metadata** required by Windows/Tauri and
browser formats. Without it, the selected snapshot's existing component version
is used: desktop Tauri config, CLI Cargo workspace, extension browser manifest,
or server package.json. This includes current development placeholders. A label
is sufficient for a normal private test; it does not require choosing a new
version convention. Explicit overrides use `X.Y.Z`; the extension additionally
accepts `X.Y.Z.W`. Browser versions cannot be all zero. A future public numbering
scheme can be implemented without changing the meaning of the opaque label.

```powershell
.\release.ps1 extension -Label browser-friends-b -Version 0.1.2
.\release.ps1 cli -Label terminal-friends-b -Version 0.0.1
```

Extension overrides change only the staged browser manifest. CLI overrides are
stamped at compile time and checked against the executable's `--version`.
Desktop overrides stamp installer metadata and its bundled CLI. Repository
version files and Cargo.lock are left alone. Server overrides identify the
distribution archive; the current server API exposes no release-version endpoint.

## Products and contents

| Product | Output | Build platforms |
| --- | --- | --- |
| desktop | Windows NSIS setup EXE, or Linux Debian and AppImage installers; embeds CLI/native host needed by desktop's connector | `windows`, `linux`, `both`, or `native` |
| cli | Independent CLI/native-host archive and the registration script for that OS; no desktop binary | Same native platforms |
| extension | Chromium runtime ZIP with manifest, JS, HTML and assets; tests and type declarations excluded | Portable; omit `-Platform` |
| server | Offline application/web, PostgreSQL and OpenSSL image TAR; Compose, operator/installer helpers and recovery instructions | Linux amd64 containers on Windows or Linux; omit `-Platform` |

Desktop normally has no extra portable desktop ZIP; use the independent CLI
archive if that is what the recipient needs. Each output includes a product
README, adopted source and commercial license agreements, `SHA256SUMS`, `release.json`, and a
standalone `verify-release.mjs`. Build config, test sources, source archives,
dependency folders and compiler output directories stay in the cache.

Rust client executables and cryptographic WASM are compiled. Desktop/web frontend
assets are bundled, while extension JavaScript and server Node modules remain
readable runtime code. Images and bundling do not conceal that code. Server Compose
YAML, installer scripts and user instructions are required distribution files;
development workflow YAML, tests and the full source checkout are excluded.

Example default output layout:

```text
C:\Projects\127Vaults-Releases\
  release-index.json
  desktop\friends-a\windows\...
  desktop\friends-a\linux\...
  cli\friends-a\windows\...
  extension\friends-a\chromium\...
  server\friends-a\linux-amd64\...
```

Every completed directory is immutable: rerunning the same product/label/platform
fails instead of overwriting it. Choose a new label. The independent release index
records each product's actual build commit, requested commit, package version,
input fingerprint and reuse state. Products can have different labels, versions
and build commits without pretending to be one matching repository-wide release.

## Reuse and caches

The tool fingerprints the selected product's committed files, shared dependencies,
checks, install instructions and license agreements. The packaging engine, numeric
package version, Node runtime and target platform also enter the cache key. A
new commit touching another product can reuse a previously verified artifact.
Labels do not enter that key, so a second handoff can reuse exactly the same bytes.

```powershell
.\release.ps1 extension -Label handoff-one
.\release.ps1 extension -Label handoff-two
# The second command reuses the verified artifact if its inputs are unchanged.
.\release.ps1 extension -Label handoff-three -Force
```

On reuse, every cached file is hash-checked. The release records the original
`sourceRevision` and separately records `requestedSourceRevision`; it does not
relabel old bytes as a newly compiled commit. Corruption fails closed before
delivery. `-Force` rebuilds and creates a new cache object without deleting the
corrupt or older one. Completed releases are preserved.

On a cache miss, the pnpm content store, Cargo target directory, Cargo registry,
container build layers and Tauri helper caches remain available. Dependencies
are installed with the frozen lockfile in the fresh snapshot, using the shared
pnpm store. A first build on a new cache still requires downloads and compilation.
An unchanged artifact hit skips dependency installation and compilation entirely.

For an intentional server base-image refresh:

```powershell
.\release.ps1 server -Label server-base-refresh -RefreshBaseImages
```

This forces a rebuild and pulls the Node bases as well as the bundled PostgreSQL
and OpenSSL images. Normal reuse retains the reviewed artifact bytes. Inner
server manifests record the actual saved image IDs, and release-specific image
tags preserve the development `:test` tag.

The dependency allowlists are in `scripts/release/plan.mjs`. When adding a new
shared import, update that product's input list and its dependency tests. These
are conservative source fingerprints, not a claim of a fully automatic build
graph or cross-version API compatibility proof. Shared Rust changes affect native
clients; shared UI/passkey metadata changes also affect the desktop/server users
of those modules. Extension popup-only edits need not rebuild native clients.

## Windows and Linux workers

Windows builds run locally. For Linux targets from Windows, the tool invokes the
selected WSL distribution and user, reads the **same committed Windows repository**,
and exports it into a Linux-native cache. You do not need to synchronise a second
Linux checkout. Rust targets and dependencies are not shared between Windows and
Linux. Linux artifacts are delivered into the common Windows output directory.

Defaults: WSL `Ubuntu-24.04`, that distribution's default user, Windows cache
`~/.127vaults-release-cache`, and the Linux worker's own directory with the same
name. Use an unprivileged Linux development user. Select external directories:

```powershell
.\release.ps1 desktop -Platform both -Label cross-platform-a `
  -OutputRoot C:\127Vaults-Releases `
  -CacheRoot C:\127Vaults-Release-Cache `
  -WslUser vaults-dev -LinuxCacheRoot /home/vaults-dev/vaults-release-cache
```

Cache and output roots must be outside the checkout, separate from one another.
Release cache locks serialize native builds so simultaneous calls cannot overwrite
shared Cargo/Tauri artifacts. A separate short lock protects release-index updates.
A crashed process may leave a lock file. Inspect its PID/host and confirm no build
is active before removing that specific lock; the tool never guesses that another
process's lock is safe to delete. Cache cleanup is manual in this first pass.

Build failures retain `attempts/<id>/plan.json`, source/stage files and
`failure.json` for diagnosis. No complete release is published after failed
checks. Capture terminal logs with PowerShell `Tee-Object` if you need a transcript.

## Verify and future CI

```powershell
.\release.ps1 -Verify C:\Projects\127Vaults-Releases\extension\friends-a\chromium
```

Recipients without the repo can run `node verify-release.mjs .` inside a supplied
release directory. The verifier checks file sizes/hashes, the checksum list, and
unexpected files or symlinks. As these builds are unsigned, obtain the checksum
through a trusted sender channel; this is file integrity, not publisher identity.

On a native Linux host, or in future CI, use the same Node engine with a JSON
request containing `product`, `repository`, `platform`, `label` and optional roots:

```sh
node scripts/release/release.mjs --config release-request.json
```

The PowerShell wrapper passes that same request through stdin. GitHub Actions
can eventually call the wrapper/engine and upload its verified product artifacts.
No runner registration, GitHub authentication, publishing or release catalogue
updates are included in this first pass.

## Acceptance boundaries

Checks are product-specific: extension syntax/tests; native client library tests
and executable/host probes; desktop type/native/frontend checks and tests;
server/web checks/tests, fresh WASM bindings and installer/operational tests.
Packaging does not launch or enrol the desktop, start a data-bearing server, or
modify browser registrations. It does not install host prerequisites automatically.

All outputs remain unsigned private-test distributions. The included policy is
not an actual public release license. Clean-host installation, native Linux server
secret permissions, Docker runtime acceptance, full GUI/keyring/native messaging
acceptance, signing and compatibility version ranges remain separate work. API v1
and native messaging v1 metadata are informational; no unchosen minimum-server
version is fabricated. Existing legacy `package:local` and `package:assemble`
commands remain available for the earlier test handoff format.

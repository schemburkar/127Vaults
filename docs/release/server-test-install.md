# Install the private server test bundle

Status: experimental test distribution, 2026-10-02. This is the chosen shipping form for the server: OCI image archives (127Vaults, PostgreSQL and the isolated OpenSSL certificate helper), a base Compose file with an optional SMTP overlay, and one operator command with internal helpers. An MSI or standalone binary would add a second database/service/update path without improving this private server deployment. Do not publish the bundle or use it as a supported real-credential release yet.

The server image runs `apps/server/src/entry.mjs serve`; that entry dispatches provisioning, schema migration, and liveness checks to modules in `apps/server/src`. In the source checkout and extracted bundle, `node server.mjs` is the operator entry and imports its helper modules. Bundle helpers live under `lib/` and are included in the hash manifest. Development acceptance scripts under `scripts/` are test harnesses, not separate installation methods.

**Usability verdict:** this is suitable for a technical operator running a supervised test, not a self-service client installer. The recipient still needs a container engine, Compose, Node 24, private CA trust, firewall configuration and backup-key custody. A one-click installer would hide operational and recovery decisions that are not settled yet.

## Build once on the development machine

Install the pinned Rust/WASM generator, Node/pnpm dependencies and Podman as in [experimental development](experimental-development.md). From the repository root, use a new output directory **outside** the checkout:

```powershell
node server.mjs bundle C:\127vaults-test-bundle
```

The bundle contains `server-image.tar`, `postgres-image.tar`, `compose.test.yaml`, the operator scripts and `manifest.json` with SHA-256 hashes. Transfer it by a trusted channel and compare the manifest hashes before loading. The manifest records whether the source tree was dirty. This is a reproducible handoff format, not a signed release or independent supply-chain attestation.

## Test-machine prerequisites

New bundles provide a standard launcher. After extracting, run `./install.ps1 doctor`
then `./install.ps1 setup --endpoint 127.0.0.1` on Windows, or `bash install.sh doctor`
then `bash install.sh setup --endpoint 127.0.0.1` on Linux. For Docker append
`--docker`; Windows Podman discovers `podman-compose.exe` on PATH or accepts an
explicit `--compose-provider` path. `verify` checks the bundle without engine
access; `bootstrap`, `status`, `start` and `stop` use the same launcher. Existing
identities are preserved. The detailed operator commands below remain available.

`doctor` reports bundle integrity, Node version, existing installation identity,
engine availability, engine connectivity, and Compose separately. It reports all
independent failures with next steps and exits nonzero when prerequisites are not
ready. Each external prerequisite probe has a 15-second deadline; a stopped
engine or stalled Compose provider cannot leave the check waiting indefinitely.
It does not start containers, load images, generate keys, or change configuration.
For a machine-readable, redacted report, run:

```powershell
./install.ps1 doctor --json
```

On Linux use `bash install.sh doctor --json`. The JSON has `format`, `ready`,
`engine`, and `checks` with `id`, `status` (`pass`, `fail`, or `skip`), `message`,
and failure `nextStep`. It excludes engine output, configuration values, private
paths, and key contents. JSON is supported only for `doctor`.

`setup` and `start` use the same preflight. They refuse malformed options,
non-private or invalid IPv4 endpoints, a private directory inside the bundle,
and incomplete existing identity files before loading images or starting the
server. An existing `.env` must identify exactly one project, endpoint and
absolute private directory. Explicit endpoint/private-directory options must
match that installation. Preserve a damaged configuration and recover its
matching identity. When omitted on setup/start, the private-directory option is
resolved from the validated existing configuration, so a custom identity path
does not silently fall back to the default. Removing `.env` to regenerate keys
can strand existing data.

`stop` and `status` remain available when identity files are damaged, provided
bundle, Node, engine and Compose checks pass. Identity checks inspect file
presence and nonempty regular files; they do not validate certificates, key
formats, permissions, or a running database's identity. A passing doctor is
prerequisite evidence, not HTTPS, backup, clean-host or release acceptance.

- Windows 11 with Podman machine and a Compose provider, or Linux with Podman plus a Compose provider. Docker Engine with Docker Compose is an alternate **unverified** path until the Docker matrix is run.
- Node.js 24 for the operator scripts. The client machine does not need Rust, wasm-bindgen, pnpm or source files.
- A private IPv4 or loopback endpoint, adequate disk for both image archives and a persistent PostgreSQL volume, and a separate location for backup keys and encrypted backups.
- No public port forwarding, public DNS, shared host, or real credentials until the release gates are accepted.

In an extracted bundle directory, first compare each file to `manifest.json`. On Windows, run PowerShell as the intended operator; on Linux, use a private directory owned by that operator. The default private identity directory is `~/.127vaults-test`, outside the bundle.

```powershell
node server.mjs install init --endpoint 127.0.0.1
node server.mjs install start
node server.mjs install status
node server.mjs install identify
node server.mjs install bootstrap
```

For the explicitly enabled self-hosted signup simulation, the customer downloads the `.tar` archive generated alongside the bundle directory. Extract it, enter the extracted directory, then follow the commands above. After `install identify`, save `license.json` from the simulated order and run:

```powershell
node server.mjs install license --file license.json
node server.mjs install start
```

For this short command, the bundle must contain `issuer-keys.json` and its hash in `manifest.json`. A legacy test bundle without a pinned key still requires `--public-keys <trusted issuer keys>`. The operator command checks the license signature, installation binding, active dates, and increasing sequence, then places versioned files under the private runtime directory and configures the server's authenticated license status endpoint. The signed license drives test seat and vault-write checks; this command does not process payment or turn the bundle into a production release. Verify the bundle's issuer key through a trusted operator channel; its manifest hash alone is not a public release signature.
Signed test licenses now reserve seats for active users and live invitations and block vault writes during the 30-day read-only grace and later locked state. The server stores a high-water clock checkpoint under the private output directory. A backward wall-clock step over two minutes locks licensed writes until the host clock catches up. The existing identity backup does not include this checkpoint; retain it separately during a restore. Deleting or restoring an older copy weakens rollback detection. The host clock remains operator-controlled, so this is not a trusted-time or production billing boundary.

For an issuer-directed revocation, the offline issuer signs a file bound to the installation and current license ID. The operator installs it with `node server.mjs install revoke --file revocation.json`, then runs `node server.mjs install start`. A revoked license blocks vault and invitation writes immediately; sign-in, reads, device recovery and vault restoration remain available so encrypted data is not stranded. A newly issued higher-sequence license has a different ID and clears the active revocation when installed. License-sequence rollback and host-level tamper resistance remain release gates.

The installer checks every bundle file against `manifest.json` before `init` and `start`. The first command creates a local CA, certificate, runtime keys and `.env` without overwriting an existing installation. `start` loads the OCI images, starts a private PostgreSQL container and a non-root/read-only server, and preserves the named database volume across `stop`/`start`. `status` prints the installation ID, effective license state and expiry, clock state, active and reserved seats against the cap, owner enrollment, SMTP configuration, and the next operator step. It never prints the bootstrap code. The authenticated `/api/v1/license` response also reports seat use and available seats without revealing the installation ID. Verify the displayed CA fingerprint through the operator channel, trust its public certificate on the test browser, and open `https://127.0.0.1:12780`. The web client detects an empty installation and opens the first-owner registration form automatically. `bootstrap` prints a one-time owner setup code. The browser flow still needs a human acceptance pass on the target machine.

For Podman, install `podman-compose` and pass its full executable path with `--compose-provider <path>` to `start`, `status`, `bootstrap`, and `stop`. This avoids Podman accidentally selecting a stale Docker Compose shim. For Docker, append `--docker` to each command and use Docker Compose without `--compose-provider`. TLS generation uses the selected engine. Docker is a candidate until the exact clean-host acceptance is recorded. For private LAN, pass a literal private IPv4 to `--endpoint` for `init`; `start` reads and verifies the initialized endpoint; the certificate and publication address are bound to it. Verify OS firewall rules and certificate trust on every client. Use `node server.mjs install stop` to stop without deleting data. **Never use `compose down --volumes` on a data-bearing installation.**

On Windows with Podman, the operator now refuses `start`, `status`, `identify`, `license`, `bootstrap`, `restore`, or `stop` without `--compose-provider <full path to podman-compose>`. Pass the flag to each command that needs Compose. The installed Docker Compose Windows shim can stall instead of connecting to Podman.

For invited-user email verification, configure a trusted SMTP-over-TLS service on port 465. After `init`, append `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_FROM`, and `VAULTS_INSTALLATION_LABEL` to `.env`. Write the SMTP password alone to `<private directory>/runtime/smtp-password` with operator-only permissions; do not put it in `.env`. On `start`, the installer adds `compose.smtp.yaml`, which gives only the server an outbound network while PostgreSQL remains on the private backend. Invalid SMTP configuration fails startup. This external SMTP path needs a live provider and egress test before invited-user real-data use; the default installation supports only the first owner.

## Enable the internal admin console

The loopback server bundle includes the read-only console at `/admin/` and its
operator setup command. After installation initialization, use the actual private
identity directory and a separate operator password:

```powershell
$operatorFile = Join-Path '<private-directory>' 'runtime/admin-operators.json'
$securePassword = Read-Host 'New admin operator password' -AsSecureString
$env:VAULTS_ADMIN_SETUP_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
try { node server.mjs admin init localowner $operatorFile }
finally { Remove-Item Env:VAULTS_ADMIN_SETUP_PASSWORD }
node server.mjs install start --compose-provider '<full path to podman-compose>'
```

The first operator is an owner and its file cannot be overwritten by this command.
Restart loads the file. Vault identities remain separate. Account, role and device
management writes remain in the existing operator/client workflows; the console
provides inspection only. Private-LAN deployments refuse admin access. The encrypted
identity backup includes `runtime/admin-operators.json` when present; older backups
without console operators remain readable. The command also works in the source
checkout and requires only Node 24 in an extracted bundle.

## Backup and restore rehearsal

Create a random 32-byte backup key in a protected path that is **not** the installation directory or backup destination, using `node server.mjs database keygen --output <private-key-path>`; retain an offline recovery copy. The same `server.mjs` command is used in the source checkout and extracted bundle. Set the exact database container name from `node server.mjs install status`. The project name is generated during `init` and recorded in `.env`, preventing a new test identity from accidentally reusing an older test volume.

```powershell
node server.mjs database backup --engine podman --container <project>_database_1 --output D:\backups\vaults-20261002.127vbak --key-file D:\keys\vaults-backup.key
node server.mjs database rehearse --engine podman --input D:\backups\vaults-20261002.127vbak --key-file D:\keys\vaults-backup.key
```

The first command takes a transactionally consistent PostgreSQL custom dump of a known schema 1 through 6 installation, encrypts it in the authenticated `127VBAK1` envelope, verifies that envelope, and removes its plaintext temporary file. The second decrypts into a private temporary directory, starts a new unpublished `--network none` PostgreSQL container, proves its database is empty, restores in one transaction, checks installation/schema/account/item invariants, then removes that disposable container and temporary file. The source database and its volume are never modified. Temporary files are deleted, but ordinary filesystem deletion is not a secure erase guarantee; use an encrypted host filesystem for real data. Keep the backup key separate from the encrypted backup.

The database backup is **not enough** to recover the installation. Back up its CA and runtime keys separately, with a second protected key and a separate storage location:

```powershell
node server.mjs identity backup --private-dir <private-directory> --output D:\identity-backups\identity.127vbak --key-file D:\keys\identity-backup.key --server-id <installation-uuid>
node server.mjs identity restore --input D:\identity-backups\identity.127vbak --output-dir D:\restore\identity-new --key-file D:\keys\identity-backup.key --server-id <installation-uuid>
```

The restore refuses to overwrite a directory and checks the supplied installation ID. It restores the CA certificate/key, current leaf, token and checkpoint keys, database/readiness secrets and optional SMTP secret. It restricts the Windows directory ACL to the operator, System and Administrators. Keep the database and identity backup keys separately. Never replace the only live identity in place. Losing the original CA or checkpoint key can strand client trust or signed sync verification even when the database dump is intact.

### Combined recovery rehearsal

Use a **new bundle directory** and a **new Compose project/volume**. Record the installation UUID in both backup envelopes and prove they match. Restore the identity to a new private directory, then initialize the bundle against that identity:

```powershell
node server.mjs install init --endpoint 127.0.0.1 --restore-identity D:\restore\identity-new
```

Run the guarded database restore with the matching backup and key:

```powershell
node server.mjs install restore --input D:\backups\vaults-20261002.127vbak --key-file D:\keys\vaults-backup.key
```

This starts only the new project's database, refuses a nonempty schema, authenticates the backup, requires current schema 6 and a matching installation ID, imports in one transaction, and verifies the restored installation ID. Older backups can be rehearsed in isolation, but the current server requires an explicit migration before serving them. It preserves the new volume for inspection on failure; it never touches the source project. Use an encrypted host filesystem for temporary plaintext. Keep the old installation stopped if both use port 12780. A restore-mode `start` also refuses to launch the server until the database installation ID matches the restored identity.

Now run `node server.mjs install start` for the new project, check HTTPS readiness with its restored CA/readiness token, and authenticate a client that was enrolled before the backup. Confirm it can list and decrypt a known item. The earlier manual sequence was rehearsed with a fictitious owner, one vault and one item on a second Podman project; the new guarded command needs its own end-to-end run.

This rehearsal does not yet prove a graphical browser login against the restored database, automatic upgrade/rollback, Docker support or recovery on an unrelated host. Those remain tracked in the [server backlog](../product/server-backlog.md).

## Updates and release shape

Build a new bundle with a new manifest and image digest; do not replace image archives in an existing bundle. Take and rehearse an encrypted backup before any schema migration. Stop the application, run the reviewed migration with a bounded lock wait, start the new image, verify readiness and an authenticated client flow. Rollback uses the matching prior image and a **new** isolated restore from the pre-upgrade backup; do not run old code against a migrated volume. No auto-updater, registry publication, MSI or binary release is approved for this test stage.

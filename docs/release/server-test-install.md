# Install the private server test bundle

Status: experimental test distribution, 2026-10-02. This is the chosen shipping form for the server: OCI image archives (127Vaults, PostgreSQL and the isolated OpenSSL certificate helper), one Compose file and one operator command and internal helpers. An MSI or standalone binary would add a second database/service/update path without improving this private server deployment. Do not publish the bundle or use it as a supported real-credential release yet.

**Usability verdict:** this is suitable for a technical operator running a supervised test, not a self-service client installer. The recipient still needs a container engine, Compose, Node 24, private CA trust, firewall configuration and backup-key custody. A one-click installer would hide operational and recovery decisions that are not settled yet.

## Build once on the development machine

Install the pinned Rust/WASM generator, Node/pnpm dependencies and Podman as in [experimental development](experimental-development.md). From the repository root, use a new output directory **outside** the checkout:

```powershell
node server.mjs bundle C:\127vaults-test-bundle
```

The bundle contains `server-image.tar`, `postgres-image.tar`, `compose.test.yaml`, the operator scripts and `manifest.json` with SHA-256 hashes. Transfer it by a trusted channel and compare the manifest hashes before loading. The manifest records whether the source tree was dirty. This is a reproducible handoff format, not a signed release or independent supply-chain attestation.

## Test-machine prerequisites

- Windows 11 with Podman machine and a Compose provider, or Linux with Podman plus a Compose provider. Docker Engine with Docker Compose is an alternate **unverified** path until the Docker matrix is run.
- Node.js 24 for the operator scripts. The client machine does not need Rust, wasm-bindgen, pnpm or source files.
- A private IPv4 or loopback endpoint, adequate disk for both image archives and a persistent PostgreSQL volume, and a separate location for backup keys and encrypted backups.
- No public port forwarding, public DNS, shared host, or real credentials until the release gates are accepted.

In an extracted bundle directory, first compare each file to `manifest.json`. On Windows, run PowerShell as the intended operator; on Linux, use a private directory owned by that operator. The default private identity directory is `~/.127vaults-test`, outside the bundle.

```powershell
node server.mjs install init --endpoint 127.0.0.1
node server.mjs install start
node server.mjs install status
node server.mjs install bootstrap
```

The installer checks every bundle file against `manifest.json` before `init` and `start`. The first command creates a local CA, certificate, runtime keys and `.env` without overwriting an existing installation. `start` loads the OCI images, starts a private PostgreSQL container and a non-root/read-only server, and preserves the named database volume across `stop`/`start`. Verify the displayed CA fingerprint through the operator channel, trust its public certificate on the test browser, and open `https://127.0.0.1:12780`. `bootstrap` prints a one-time owner setup code. The browser flow still needs a human acceptance pass on the target machine.

For Podman, install `podman-compose` and pass its full executable path with `--compose-provider <path>` to `start`, `status`, `bootstrap`, and `stop`. This avoids Podman accidentally selecting a stale Docker Compose shim. For Docker, append `--docker` to each command and use Docker Compose without `--compose-provider`. TLS generation uses the selected engine. Docker is a candidate until the exact clean-host acceptance is recorded. For private LAN, pass a literal private IPv4 to `--endpoint` for `init`; `start` reads and verifies the initialized endpoint; the certificate and publication address are bound to it. Verify OS firewall rules and certificate trust on every client. Use `node server.mjs install stop` to stop without deleting data. **Never use `compose down --volumes` on a data-bearing installation.**

For invited-user email verification, configure a trusted SMTP-over-TLS service on port 465. After `init`, append `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_FROM`, and `VAULTS_INSTALLATION_LABEL` to `.env`. Write the SMTP password alone to `<private directory>/runtime/smtp-password` with operator-only permissions; do not put it in `.env`. On `start`, the installer adds `compose.smtp.yaml`, which gives only the server an outbound network while PostgreSQL remains on the private backend. Invalid SMTP configuration fails startup. This external SMTP path needs a live provider and egress test before invited-user real-data use; the default installation supports only the first owner.

## Backup and restore rehearsal

Create a random 32-byte backup key in a protected path that is **not** the installation directory or backup destination, using `node server.mjs database keygen --output <private-key-path>`; retain an offline recovery copy. The same `server.mjs` command is used in the source checkout and extracted bundle. Set the exact database container name from `node server.mjs install status`. The project name is generated during `init` and recorded in `.env`, preventing a new test identity from accidentally reusing an older test volume.

```powershell
node server.mjs database backup --engine podman --container <project>_database_1 --output D:\backups\vaults-20261002.127vbak --key-file D:\keys\vaults-backup.key
node server.mjs database rehearse --engine podman --input D:\backups\vaults-20261002.127vbak --key-file D:\keys\vaults-backup.key
```

The first command takes a transactionally consistent PostgreSQL custom dump, encrypts it in the authenticated `127VBAK1` envelope, verifies that envelope, and removes its plaintext temporary file. The second decrypts into a private temporary directory, starts a new unpublished `--network none` PostgreSQL container, proves its database is empty, restores in one transaction, checks installation/schema/account/item invariants, then removes that disposable container and temporary file. The source database and its volume are never modified. Temporary files are deleted, but ordinary filesystem deletion is not a secure erase guarantee; use an encrypted host filesystem for real data. Keep the backup key separate from the encrypted backup.

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

This starts only the new project's database, refuses a nonempty schema, authenticates the backup, checks its installation ID and schema version against the restored identity, imports in one transaction, and verifies the restored installation ID. It preserves the new volume for inspection on failure; it never touches the source project. Use an encrypted host filesystem for temporary plaintext. Keep the old installation stopped if both use port 12780. A restore-mode `start` also refuses to launch the server until the database installation ID matches the restored identity.

Now run `node server.mjs install start` for the new project, check HTTPS readiness with its restored CA/readiness token, and authenticate a client that was enrolled before the backup. Confirm it can list and decrypt a known item. The earlier manual sequence was rehearsed with a fictitious owner, one vault and one item on a second Podman project; the new guarded command needs its own end-to-end run.

This rehearsal does not yet prove a graphical browser login against the restored database, automatic upgrade/rollback, Docker support or recovery on an unrelated host. Those remain tracked in the [server backlog](../product/server-backlog.md).

## Updates and release shape

Build a new bundle with a new manifest and image digest; do not replace image archives in an existing bundle. Take and rehearse an encrypted backup before any schema migration. Stop the application, run the reviewed migration with a bounded lock wait, start the new image, verify readiness and an authenticated client flow. Rollback uses the matching prior image and a **new** isolated restore from the pre-upgrade backup; do not run old code against a migrated volume. No auto-updater, registry publication, MSI or binary release is approved for this test stage.

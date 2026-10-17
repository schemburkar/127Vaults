# Sunrise published consumer flow, 2026-10-17

Status: basic online acceptance passed for web, desktop, CLI, and extension using the published packages. Deployment required Podman host workarounds; the published installation flow is not accepted end to end. See the latest checkpoint below; earlier resume points are historical. No application builds or package modifications were used.

## Environment and distribution

- Sunrise: Windows 10 Pro x64, build 19045, approximately 8 GB RAM.
- Tests ran on Sunrise through SSH and its interactive Edge session. The installed desktop was inspected through its WebView2 debugging interface.
- Entry point: https://127vaults.com, then Downloads, Request access, and the approved private trial invitation.
- Published release source: `69e078a77b843f0f34bb39411d68a43d15aecf29`.
- Docker Desktop 3.0.4, Docker Engine 20.10.2, standalone docker-compose 1.27.4. The bundled `docker compose` command exposes an older command set.
- The existing Node.js 16 was left installed. Official Node.js 24.22.0 was downloaded, verified against its official SHA256SUMS, and used from the trial downloads directory.
- Downloaded packages and extracted files are under `C:\Users\shubh\Downloads\127Vaults-Trial` on Sunrise.

## Verified outcomes

1. Personal access request for one user returned HTTP 202 and displayed the request-received confirmation.
2. The human operator approved the request and supplied the customer invitation. That invitation displayed the expected private packages and activation instructions.
3. Server, Windows desktop, Windows CLI, and Chromium extension downloads completed. Every archive/executable matched the SHA-256 displayed on the invitation.
4. The published CLI extracted and displayed its help successfully.
5. The human completed the Windows desktop installer and confirmed the app launched. The installed app displayed its unlock screen and the registration/server-trust form.
6. After starting Docker Desktop and its Windows service, the published doctor passed bundle integrity, Node, fresh installation, engine, engine connectivity, and Compose availability.
7. Loopback server initialization created an installation identity and TLS material. Published server, PostgreSQL, and certificate-helper images loaded successfully.

## Findings

### Private IPv4 initialization is broken

Both `node server.mjs install init --endpoint 100.99.146.58 --docker` and the same command with Sunrise's actual RFC1918 address `192.168.68.57` fail with:

```text
Server operator: Use loopback or a private IPv4 endpoint.
```

Inspection of the downloaded `lib/test-install.mjs`, line 43, confirms the RFC1918 validation expression ends its private-address alternatives in a literal dot and omits the final octet. It rejects ordinary private IPv4 addresses. Tailscale's CGNAT range is also absent from the accepted alternatives. The published setup guide explicitly describes private IPv4 installation; the public site describes Tailscale as a remote-access option.

Continued using the documented `127.0.0.1` option. No validation bypass or package edit was applied. Cross-computer connectivity remains untested and blocked in this release.

### Compose preflight accepts an incompatible installation

Doctor reported `PASS compose: Compose provider is available.` However, `node server.mjs install start --docker` loaded the published images, then failed with:

```text
unknown flag: --no-build
Server operator: docker operation failed (1); inspect the local container logs.
```

The shipped command invokes `docker compose ... up -d --no-build`. Sunrise's existing Compose command does not accept that option. The preflight should reject incompatible Compose implementations with an actionable version/capability requirement. This run does not establish a failure with current supported Docker installations.

### Remote-test environment adjustment

SSH supplied `USERDOMAIN=WORKGROUP`, while `whoami` returned `sunrise\shubh`. TLS initialization consequently attempted to grant permissions to nonexistent `WORKGROUP\shubh` and failed. Setting `USERDOMAIN=SUNRISE` only in the remote test process allowed the unchanged installer to initialize. This observation is specific to the remote execution environment; it has not been reproduced from the user's ordinary interactive shell.

An initial Docker executable probe also timed out. One direct `docker --version` call took approximately 48 seconds. A later doctor run passed. Distinguish this host startup delay from the reproducible Compose incompatibility above.

## Resume point

- Update Sunrise's Docker/Compose prerequisite through its normal supported installation flow, then rerun doctor and server start against the preserved loopback installation.
- Preserve the existing bundle `.env`, private identity directory, and keys. Do not reinitialize or delete them to retry startup.
- Trial activation has not been submitted; the ten-day license has not started.
- Still untested: installation-ID retrieval, trial activation/license download and installation, HTTPS client trust, owner creation, desktop enrollment/unlock, encrypted item operations, sync, offline use, and extension filling.
- The extension is now loaded into Edge and its packaged connector is registered; source access and filling remain untested.
- Invitation bearer tokens, contact email, private keys, bootstrap codes, and account secrets are deliberately excluded from this report.

## Continued loopback run

The user explicitly chose to continue with loopback and requested basic coverage across all clients before considering first-party Tailscale integration.

- Existing `docker-compose` 1.27.4 supports `--no-build`. Invoking that command directly against the shipped Compose file and preserved project created the private backend network, database volume, and database container. No package file was changed.
- Database startup failed: `initdb` reported `could not execute command ... postgres -V: Cannot allocate memory`. Docker reported `OOMKilled: false`, a 512 MiB container limit, and approximately 6.1 GiB of Docker VM memory. The PostgreSQL binary runs its version command in an ordinary disposable container, but an isolated `initdb` probe using the published capability-drop/no-new-privileges settings reproduces the initialization failure. The precise syscall-level cause has not been established.
- Stopped the failed database container to avoid repeated initialization attempts. Its volume and installation identity are preserved.
- Started official Docker Desktop and Microsoft WSL prerequisite downloads through Sunrise's browser. WSL 3.0.3.0 x64 completed and its Authenticode signature validated as Microsoft Corporation. Its interactive installer is open for the human to complete. Docker's browser download reports its full 607 MiB received but has not yet finalized its temporary file; signature verification and installation remain pending. The existing WSL does not recognize `wsl --version`.
- The published CLI reports a fresh unconfigured/unauthenticated/locked/offline state with secrets redacted.
- Local CLI generation passed: a 24-character password includes every enabled character class; an eight-digit PIN matches its requested format; a six-word passphrase has six words. Generated values were not included in the report.
- The user loaded the published Chromium extension in Edge, ID `aljmkcbbeondcmmjjmnhmacpfnppiloe`. Verified extension version 0.1.0 in Edge and registered the packaged native messaging host using its shipped registration script. Actual source access and filling remain pending.
- Public CA DER SHA-256 for this preserved installation: `EEE2BC2628C1933F0994E6E68FEBBC7734B82A5D79F139AD2B42DAA569491C33`. No CA private key was transferred.

## Basic client acceptance checklist

Continue on Sunrise only, using `https://127.0.0.1:12780`, the preserved installation, and the published packages. First-party Tailscale discovery/integration is outside this run.

1. Finish the prerequisite installers, rerun doctor, and start the preserved server. Confirm database/server health and loopback binding before activating the trial.
2. Retrieve the installation UUID; activate the supplied customer invitation; download and install its license using the published flow. Confirm license state and the one-user limit.
3. Compare the public CA fingerprint with the recorded value, establish client trust, and create a disposable first owner through the published web setup. Keep bootstrap codes, account secrets, recovery material, and passwords outside this report.
4. In the web client, create a vault named `Sunrise Smoke` and a fictitious login named `Sunrise smoke login`, username `sunrise-smoke@example.invalid`, using a newly generated test password. Confirm save and reopen.
5. Enroll the installed desktop through the normal approval flow. Confirm the same vault/item, edit a harmless note, sync, and verify the edit in the web client.
6. Enroll the packaged CLI. List the same vault/item and verify the desktop edit through the normal commands. Confirm CLI status reflects its actual authenticated state.
7. Open the extension through a real toolbar click on a suitable login page so Edge grants active-tab access. Select an unlocked enrolled source, find the synthetic item, and request filling. Verify field values and that the form is not submitted automatically. An extension popup opened as its own tab is not a valid fill acceptance test.
8. Stop only the test server, confirm desktop access to the synchronized item offline, restart the same server, and confirm synchronization resumes. Preserve the database volume and identity throughout.

The WSL installer remains with the human operator. On the latest check Docker's download had reached 636,811,696 bytes but retained its `.crdownload` suffix. Do not run it or count installation as passed until the browser finalizes it and its publisher signature is verified.

## Prerequisite update checkpoint

The human completed WSL installation. `wsl --version` now reports WSL 3.0.3.0 and kernel 6.18.54.1-1. The Docker download finalized; its Authenticode signature validated as Docker Inc. The downloaded installer reports version 4.95.0.242831, was copied to `C:\Users\shubh\Downloads\127Vaults-Trial\Docker-Desktop-Installer.exe`, and is running in the interactive Sunrise session for the human to complete.

Before that Docker update completes, the CLI still reports version 20.10.2 and cannot reach `docker_engine_linux`. This is not evidence that the new Docker engine has failed: the update has not yet been confirmed complete. Server startup, activation, and client acceptance remain pending. The preserved loopback installation has not been reinitialized.

## Latest checkpoint: Podman and basic client acceptance

The user abandoned the stuck Docker Desktop updater and authorized Podman. Installed official signed Podman 6.1.4 and Podman Desktop 1.30.5. The native Docker Compose 5.6.0 executable matched its official SHA-256. Python `podman-compose` was removed and was not used for this acceptance run. Product packages and container images remained the downloaded release.

The older published Windows operator helper requires a Python Compose provider. For this run, native Compose was invoked manually against the shipped Compose file with the preserved project, identity, and database volume. The locally committed native-provider changes were not substituted into Sunrise's release bundle.

| Check | Result |
| --- | --- |
| Server and PostgreSQL | Both healthy under Podman; database schema 8 |
| Trial activation | Completed through the public invitation; downloaded license passed the shipped signature, installation-binding, date, and sequence verifier |
| Effective license | Active commercial trial, one active user maximum, expires 2026-10-27 12:33:30 UTC |
| HTTPS trust | Public CA checked against the recorded certificate fingerprint; human approved Windows trust; no certificate validation bypass |
| First owner | Created through the published server-hosted browser setup using synthetic test credentials |
| Web | Created `Sunrise Smoke` and `Sunrise smoke login`; saved and reopened encrypted login |
| Desktop | Saved verified server trust, enrolled through web approval, unlocked, read the same item, and edited its username |
| Cross-client sync | Desktop edit appeared in web after sync and reopening the item; the already open web detail pane initially retained its old value |
| CLI | Enrolled, authenticated, unlocked, listed the vault and item, read the desktop edit, matched the generated password, and synced with zero pending changes/conflicts |
| Extension | Real Edge toolbar click granted active-tab access; CLI source listed the item and filled the public test form's username and password correctly without submitting |
| Desktop offline | With only the server stopped, locked desktop reopened its encrypted replica, saved an edit with one change queued, then reconnected and synced that edit to web; zero changes remained pending |

The fill target was `https://the-internet.herokuapp.com/login`. Only synthetic credentials were filled. No form submission or login to that service was attempted. Multiple Edge profiles were open, but the automated test browser contained both the unlocked vault tab and the extension toolbar popup. No browser profile was copied or merged.

### Host adjustments and remaining release findings

- The Podman machine is `sunrise-127vaults`, using WSL with two CPUs and 2 GiB memory. It was switched to rootful Podman to access the Windows bind mounts; the server container still runs as the published non-root `node` user with the shipped restrictions.
- Podman's Windows API forwarder initially failed on a stale, zero-byte Unix socket. Removing that exact stale socket while the machine was stopped and starting the machine in the signed-in session restored it.
- TLS files created during the Docker attempt retained root-owned WSL metadata. A metadata-enabled mount of the existing private directory allowed correcting only the live directory/key ownership for UID 1000 and setting the key to mode 0600. The CA, identity, and private key contents were preserved.
- Podman's isolated `internal: true` bridge did not forward the published port. A verified-CA HTTPS request directly to the container from the VM returned 200, while the VM/Windows published loopback port timed out. This is a release deployment incompatibility, not a successful native Podman installation.
- To continue client testing without opening an external listener, an operator SSH forward connects Windows `127.0.0.1:12780` to the container through the Podman VM. The scheduled task is `127Vaults-Loopback-Forward`. This is an explicit test-host workaround and must not be represented as the published consumer setup. It depends on the current VM/container addresses and needs repair after address changes.
- Replacing the WSL relay also interrupted the VM's Windows-loopback SSH listener; the forward task restores that listener as well. The database volume and running VM were preserved.
- CLI enrollment from the SSH logon could not save its device key in Windows credential storage. Retrying in the actual signed-in interactive session succeeded with `key_storage=os`. A terminal test helper supplied synthetic credentials to the unchanged CLI's normal prompts. No development authentication path was used.
- Desktop and CLI trust use the SHA-256 of the public CA file bytes (`6B9FBF9160B07D6B38A845A5D83B4AC4EFE83E43D280D65E465B8037309BAB38`), which differs from the certificate DER fingerprint recorded earlier. Both were independently checked on Sunrise; this distinction should be clearer in consumer instructions.
- The offline attempt exposed a delayed desktop lock and extension source discovery while the server was unavailable; both recovered after the server restarted. A subsequent offline unlock completed with `server request timed out` as its offline reason. Offline read, queued edit, reconnect, and propagation to web then passed. This latency remains a usability finding, rather than an offline-data failure.
- Both web and desktop could retain stale values in an already open item detail view after synchronization/reconnection. Reopening the item showed the synchronized value. The offline edit was confirmed on both clients after reopening; it was not lost.
- The extension detected both desktop and CLI sources. Filling was verified from CLI; a separate desktop-source fill was not completed because the toolbar popup would not stay open during the final control attempt. Windows native passkeys, exhaustive CRUD/types, recovery, multi-user sharing, and cross-computer access were outside this basic run.

Final state: server and database running, desktop online, trial active with one user, test vault and item preserved, and no pending desktop edits. The native Compose and loopback-forwarding caveats above remain release blockers for claiming an uninterrupted consumer installation.

Synthetic account secrets and passwords are retained only in restricted operator/test-host files for continuing this run, not in this report or Git. No trial bearer, bootstrap code, account secret, password, or private key is included here. The email-notification aside is separate and has not changed the published deployment.

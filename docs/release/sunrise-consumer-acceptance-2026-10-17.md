# Sunrise published consumer flow, 2026-10-17

Status: partial acceptance; server startup blocked by the existing Docker Compose installation. No application builds or package modifications were used.

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
- The extension was extracted and verified but has not been loaded into Edge.
- Invitation bearer tokens, contact email, private keys, bootstrap codes, and account secrets are deliberately excluded from this report.

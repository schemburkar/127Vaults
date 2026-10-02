# Experimental development runbook

Use disposable data only. The current server provides HTTPS infrastructure,
PostgreSQL schema checks, and provisional account provisioning. It does not yet
provide usable authentication, vault APIs, or stable cryptographic storage.

## Supported v1 development path

The supported deployment is an OCI container stack: the server and PostgreSQL
run as separate containers, and PostgreSQL uses an unexposed persistent volume.
Podman with a Compose provider is the primary tested workflow; Docker Compose is
intended to remain compatible but is not yet verified.

Prerequisites: Node 24, pnpm 11.19.0, Podman, and a Compose provider. Copy
`.env.example` to `.env`, fill its credentials and absolute TLS directory, then
provision the exact endpoint before startup:

```powershell
pnpm tls:init -- 127.0.0.1 C:\private\127vaults-tls
```

Verify the printed fingerprint out of band and explicitly trust only `ca.crt`;
never distribute `ca.key`. Then run:

```sh
pnpm dev:up
pnpm dev:status
pnpm dev:down
```

`dev:up` preserves existing configuration, starts the default Podman machine
when necessary, builds the image, starts the
stack, and checks schema readiness. It does not install dependencies, select a
custom Podman machine, repair configuration, or reset data. `dev:down` retains
the database volume, credentials, and Podman VM. Failures are nonzero.

When pnpm is unavailable, `node scripts/dev.mjs up|status|down` provides the
same helper. On Windows, Podman is also discovered in its standard installation
directory. A workspace-local `podman-compose` provider is preferred, followed
by `podman compose`.

To install the currently tested workspace-local provider when Python is
available:

```powershell
python -m venv .tools/compose
.tools/compose/Scripts/python.exe -m pip install podman-compose==1.5.0
```

The strict `.env` format is documented in `.env.example`. It accepts only one
lowercase-hex `POSTGRES_PASSWORD` and one lowercase-hex
`VAULTS_READINESS_TOKEN`. Unknown, duplicate, incomplete, quoted, or malformed
settings are rejected without rewriting the file. Protect `.env` with OS account
permissions and never commit it. On `up`, the helper copies those values into
`runtime/postgres-password` and `runtime/readiness-token` under the configured
private TLS directory. Containers receive only the corresponding file paths;
neither credential nor a credential-bearing database URL appears in their
environment. Linux requires the files not be group/world writable. Windows
Podman bind mounts virtualize POSIX modes, so Windows host ACLs must restrict the
configured private directory to the operator account.

## Health and provisioning

- `https://127.0.0.1:12780/health/live` is detail-free liveness.
- `/health/ready` requires `Authorization: Bearer <VAULTS_READINESS_TOKEN>` and
  verifies schema version 1 and its SQL checksum.
- Empty-database initialization and provisional accounts are described in
  [experimental account provisioning](experimental-accounts.md).

The published server port is IPv4 loopback-only. PostgreSQL has no host port.
The server runs as user `node` with a read-only root filesystem and limited
`/tmp`. Host, Origin, forwarded-header, and bind checks reject arbitrary domains,
wildcard binds, public IPv4, arbitrary DNS names, and forwarded headers. Private
LAN mode requires one identical literal RFC1918 endpoint/publication address and
a certificate provisioned for it. Run `pnpm tls:renew -- <endpoint> <tls-dir>`
before expiry; failure preserves the prior pair. Public certificates, custom
domains, proxies, Tailscale, and Cloudflare are excluded.

Do not use `down --volumes` during normal development. An incompatible database
must be investigated; never delete it as an upgrade workaround.

## Unsupported diagnostic path

Native execution is for bounded debugging only; it is not the supported v1
deployment. Set `VAULTS_EXPERIMENTAL=1`, `DATABASE_URL`, and
`VAULTS_READINESS_TOKEN`, then run:

```sh
pnpm --filter @127vaults/server start
```

It defaults to `127.0.0.1:12780`. Private IPv4 additionally requires
`VAULTS_ACCESS_MODE=private-lan` and an explicit `VAULTS_BIND`. Do not present
this path as a production installation option.

## Current limits

- Compose provider installation and truly clean-machine setup remain manual.
- Docker automation is unverified.
- Timeout-resistant process trees and independent grandchildren are not proven
  to terminate on every platform.
- Readiness proves infrastructure and schema health, not account or vault safety.
- Container tags are development inputs, not immutable release pins.

The dated checks, exact outcomes, and remaining evidence gaps are maintained in
the [development-helper verification matrix](dev-helper-verification.md).

## Disposable encrypted item fixture

Run `pnpm fixture:build`, then `pnpm fixture:serve`, and open
`http://localhost:12781/login-item`. Use only the prefilled fictitious values.
The page stores one disposable ECF1 hierarchy and item envelope in browser storage;
it has no account, server persistence, recovery, sharing, or stable format.
Reproduction evidence is in [the Batch 4 record](disposable-login-item.md).

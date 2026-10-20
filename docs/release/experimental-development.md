# Experimental development runbook

The current experimental stack provides private HTTPS,
account authentication, and encrypted vault APIs. It is not a supported release
or a stable storage-format commitment.

## Supported v1 development path

The supported deployment is an OCI container stack: the server and PostgreSQL
run as separate containers, and PostgreSQL uses an unexposed persistent volume.
Podman with a Compose provider is the primary tested workflow; Docker Compose is
intended to remain compatible but is not yet verified.

Prerequisites: Node 24, pnpm 11.25.0, Podman, and a Compose provider. Copy
`.env.example` to `.env`, fill its credentials and absolute TLS directory, then
provision the exact endpoint before startup:

Keep `VAULTS_TLS_DIR` in a persistent, private location outside the OS Temp
directory. It contains the checkpoint signing key pinned by desktop replicas.
If moving an existing installation, copy the complete directory, verify the
copy, update `.env`, and restart the stack with the same database volume. Keep
the original directory until the replacement is verified. The startup helpers
refuse Temp paths and will not silently regenerate a missing checkpoint key
beside an existing token key.

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
directory. The development helper can use a workspace-local `podman-compose` provider.
Packaged Windows installation prefers native Compose and does not require Python;
see the server installation guide for its separate provider discovery.

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
  verifies the current schema version (8) and its SQL checksum.
- Initialization, owner bootstrap, invitation activation and guarded migrations
  are described in the [server runbook](server-test-install.md).

The published server port is IPv4 loopback-only. PostgreSQL has no host port.
The server runs as user `node` with a read-only root filesystem and limited
`/tmp`. Host, Origin, forwarded-header, and bind checks reject arbitrary domains,
wildcard binds, public IPv4, arbitrary DNS names, and forwarded headers. Private
LAN mode requires one identical literal RFC1918 endpoint/publication address and
a certificate provisioned for it. Run `pnpm tls:renew -- <endpoint> <tls-dir>`
before expiry; failure preserves the prior pair. Public certificates, custom
domains and arbitrary proxies are excluded. Packaged setup also supports verified
Tailscale endpoints; see [private connectivity](../architecture/private-connectivity.md).
Do not treat the development helper as proof of every packaged network mode.

Do not use `down --volumes` during normal development. An incompatible database
must be investigated; never delete it as an upgrade workaround.

## Unsupported diagnostic path

Native server execution is for bounded debugging only. Runtime configuration
requires secret files (including VAULTS_DATABASE_PASSWORD_FILE and
VAULTS_READINESS_TOKEN_FILE), database host/user/name, TLS identity and the explicit
experimental guard. A DATABASE_URL alone is not the current runtime contract.
Use the container runbook; do not present a partial native command as an installer.

## Current limits

- Compose provider installation and truly clean-machine setup remain manual.
- Docker automation is unverified.
- Timeout-resistant process trees and independent grandchildren are not proven
  to terminate on every platform.
- Readiness proves infrastructure and schema health, not account or vault safety.
- Container tags are development inputs, not immutable release pins.

Dated development-helper evidence is retained privately. Re-run the current
startup checks and relevant server tests when changing this workflow.

## Disposable encrypted item fixture

Run `pnpm fixture:build`, then `pnpm fixture:serve`, and open
`http://localhost:12781/login-item`. Use only the prefilled sample values.
The page stores one disposable ECF1 hierarchy and item envelope in browser storage;
it has no account, server persistence, recovery, sharing, or stable format.
Reproduction evidence is in [current documentation](../security/experimental-client-state.md).

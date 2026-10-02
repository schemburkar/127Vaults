# Compose and server-image static review

- Review date: 2026-09-07
- Scope: `compose.yaml` and `apps/server/Dockerfile`
- Requirements: ADR-0005 and ADR-0012
- Review type: bounded static inspection; containers were not built or run

## Result

The experimental deployment has a sound fail-closed starting point: PostgreSQL is
not published to the host, the server is published only on IPv4 loopback, the
backend network is internal, and the server container drops all capabilities,
forbids privilege escalation, uses a read-only root filesystem, and runs as the
Node image's non-root user. It is not release-ready. In particular, images are
mutable tags rather than digest-pinned references, the database container lacks
the server container's hardening, secrets are supplied through environment
variables, and restart/resource policies and cross-engine verification are not
defined.

## Findings

### P1 — Release images are not immutable

Evidence: `compose.yaml:4` uses `postgres:17-bookworm`, `compose.yaml:20` uses the
local mutable tag `localhost/127vaults-server:experimental`, and
`apps/server/Dockerfile:2` uses `node:24-bookworm-slim`. The Dockerfile explicitly
labels digest pinning a future release gate at `apps/server/Dockerfile:1`.

ADR-0005 requires release bases and deployment references to include immutable
digests as well as readable version tags. The PostgreSQL major is pinned, which is
appropriate for experimental development, but neither base image is reproducible
or protected from tag movement. The locally built application image also lacks a
release digest reference.

Required before release: establish an update procedure that records reviewed
Node, PostgreSQL, and published server-image digests while retaining readable
tags. Keep the current file clearly experimental until those values are supplied
by release automation.

### Resolved for Podman MVP — file-backed database and readiness credentials

Compose now exposes only `POSTGRES_PASSWORD_FILE`,
`VAULTS_DATABASE_PASSWORD_FILE`, and `VAULTS_READINESS_TOKEN_FILE`; it no longer
places either credential or a credential-bearing database URL in container
configuration. The helper writes exact 64-character lowercase-hex files into the
existing private runtime directory before startup. The server rejects missing,
empty, malformed, non-regular, symlinked, and POSIX group/world-writable files
without logging their content. Windows VM bind mounts do not preserve host ACLs
as meaningful POSIX mode bits, so the Windows helper sets a narrowly named
compatibility flag; host ACL protection remains an operator responsibility.

Rootless Podman recreation and health passed on 2026-09-10 while retaining the
named database volume and its existing owner. Native Linux permission enforcement
and Docker Engine runtime behavior remain matrix gates.

### Resolved for Podman MVP — PostgreSQL runtime hardening

The database now runs as `postgres` with a read-only root, named data volume,
bounded `/run/postgresql` and `/tmp` tmpfs mounts, all capabilities dropped,
no-new-privileges, and CPU/memory/PID limits. Rootless Podman startup, health, and
preserved-volume restart pass. Docker Engine and clean-volume recovery remain
release-matrix checks.

### P1 — Automatic migration and verified pre-migration backup are not represented

Evidence: the server starts directly with `node apps/server/src/main.mjs` at
`apps/server/Dockerfile:11`, and Compose only waits for database health at
`compose.yaml:45-47`. There is no migration/backup service or startup phase in the
reviewed files.

ADR-0005 requires a verified backup before compatible automatic migrations,
refusal for incompatible migrations, and a database migration lock. This may be
implemented outside these two files, but the current Compose lifecycle provides
no orchestration point for it. Add an idempotent one-shot migration job or an
equivalent controlled entrypoint before allowing the application to become
ready.

### Resolved for Podman MVP — restart behavior and resource ceilings

Both services now use `unless-stopped`, one CPU, 512 MiB memory and 128 PID
ceilings. PostgreSQL receives 30 seconds to stop; the server retains its tested
10-second bound. Operator override documentation and recovery-load measurement
remain open.

### P2 — Named users and writable-volume ownership need an explicit UID/GID contract

Evidence: `apps/server/Dockerfile:9` switches to `USER node`, satisfying non-root
execution for the current base image. The server has no persistent writable mount
and receives only a 16 MiB `/tmp` tmpfs at `compose.yaml:34-35`. PostgreSQL uses a
named volume without an explicit ownership contract.

For release images, record stable numeric runtime UID/GID values and verify volume
initialization/upgrade under rootless Podman and Docker Engine. A name inherited
from a mutable base is adequate for the experiment but is a weak interface for
operator-provided mounts and user-namespace mappings.

### P2 — Compose portability is plausible but unverified

Evidence: the file uses fixed IPv4 addresses and custom IPAM at
`compose.yaml:11-13` and `compose.yaml:48-56`, `depends_on.condition` at
`compose.yaml:45-47`, array-form security options at `compose.yaml:36-37`, and a
size-qualified tmpfs entry at `compose.yaml:34-35`. These features need explicit
Docker Compose and Podman Compose coverage; fixed subnet allocation may also
collide with an operator's existing networks.

Create a compatibility test matrix for the minimum supported Docker Engine +
Compose plugin and rootless Podman + compose provider. Confirm that health-gated
startup, fixed addressing, loopback publication, read-only filesystems, tmpfs,
capability drops, and graceful shutdown behave equivalently. If fixed addresses
remain necessary for bind validation, fail with an actionable subnet-collision
message or provide a safely generated subnet rather than silently weakening the
binding policy.

### P2 — Health checks are useful but need operational polish

Evidence: PostgreSQL has a local `pg_isready` check at `compose.yaml:14-18`. The
server health check at `compose.yaml:39-44` calls its minimal liveness route and
does not expose database or configuration details, matching ADR-0005. The
authenticated readiness route is intentionally not used as container liveness.

Add start-period/retry behavior for PostgreSQL based on tested cold-start and
recovery times. Ensure orchestration and operator documentation distinguish
liveness from authenticated readiness, and ensure a server marked live but not
ready is not sent user traffic in hosted deployments.

### Partially resolved — minimal runtime boundary

The Dockerfile now resolves production-only dependencies in a build stage and
copies runtime dependencies and application assets into a separate non-root
stage. Immutable base digests, a smaller reviewed runtime base, SBOM generation,
and vulnerability scanning remain release gates.

## Controls already present

- PostgreSQL has no `ports` entry, so it is reachable only on the internal backend
  network (`compose.yaml:3-18`, `compose.yaml:51-56`).
- The only host publication is `127.0.0.1:12780:12780`
  (`compose.yaml:31-32`); it is not a wildcard publication.
- The backend is marked `internal: true` (`compose.yaml:51-53`).
- The application binds to its explicit container-private address rather than
  `0.0.0.0` (`compose.yaml:26-28`, `compose.yaml:48-50`). Runtime Host/Origin and
  forwarded-header validation remains application code rather than a Compose
  guarantee.
- The server root filesystem is read-only; `/tmp` is the sole declared writable
  runtime path and is `noexec,nosuid` with a size limit (`compose.yaml:33-35`).
- The server drops every Linux capability and enables no-new-privileges
  (`compose.yaml:36-37`).
- The server runs as the upstream Node image's non-root user
  (`apps/server/Dockerfile:9`).
- Required interpolation rejects absent database and readiness credentials
  (`compose.yaml:8`, `compose.yaml:29-30`), while `.dockerignore` excludes common
  secret, certificate, database, backup, and environment files from the build
  context.
- The server's health check targets the minimal liveness endpoint, while detailed
  readiness remains outside unauthenticated orchestration probes
  (`compose.yaml:39-44`).
- The ten-second Compose stop grace period exceeds the application's eight-second
  forced-shutdown deadline, and direct exec-form `CMD` lets Node receive signals
  as PID 1 (`compose.yaml:38`, `apps/server/Dockerfile:11`).

## Small follow-up implementation tasks (Sol low)

These are intentionally independent, bounded changes; schedule tasks that touch
`compose.yaml` or the Dockerfile sequentially to avoid overlap.

1. **Release image pinning:** add a release-specific Compose overlay and Dockerfile
   inputs that require reviewed Node, PostgreSQL, and server-image digests while
   leaving the experimental workflow usable; add a static test that rejects
   tag-only release references.
2. **File-backed secrets:** add `_FILE`-style server/PostgreSQL credential support,
   Compose secret mounts, safe permission checks, and tests proving missing,
   empty, and malformed secrets fail closed without logging values.
3. **Database-container hardening:** make PostgreSQL operate with a read-only root
   filesystem, explicit writable data/run/tmp mounts, non-root identity,
   capability restrictions, and no-new-privileges; verify initialization and
   restart on Docker Compose and rootless Podman Compose.
4. **Migration gate:** add a one-shot, lock-protected migration phase that creates
   and verifies a pre-migration backup, refuses incompatible migrations, and must
   succeed before server readiness.
5. **Lifecycle and limits:** define restart policies, PID/memory/CPU defaults, and
   a tested PostgreSQL stop grace period; document operator override behavior.
6. **Portability check:** add a CI/manual matrix script validating both Compose
   engines, subnet-collision failure, loopback-only publication, internal database
   networking, read-only filesystems, health transitions, and graceful shutdown.
7. **Minimal runtime image:** convert the server Dockerfile to a multi-stage,
   production-dependency-only build with stable numeric UID/GID, then generate an
   SBOM and scan the final image in release CI.

## Release conclusion

The files are appropriate for disposable experimental infrastructure and already
implement the most important immediate network boundary. They must not be
presented as the release deployment until the P1 findings are resolved and the P2
controls are tested on both supported engines. ADR-0012's broader Tailscale,
Cloudflare-private, authority/SNI, TLS, WebSocket, and network-change requirements
remain future deployment-adapter work and cannot be established by this Compose
file alone.

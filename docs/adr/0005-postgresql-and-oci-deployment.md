# ADR-0005: PostgreSQL and OCI deployment

- Status: Accepted
- Date: 2026-09-06

## Decision

PostgreSQL is the sole supported server database. Supporting both SQLite and
PostgreSQL would multiply migrations, concurrency semantics, backup paths, and
test cases for little product value. A household with 5,000 items is a trivial
PostgreSQL workload; concurrency and one production path drive this choice.

Publish standard OCI images and Compose-compatible definitions tested with
Docker Compose and Podman Compose. Docker Desktop is never required. PostgreSQL
uses a pinned major version, persistent volume, health checks, and a private
container network with no host port by default. A native server distribution may
connect to an operator-managed PostgreSQL instance later.

Release dependencies are exactly pinned in lockfiles. Release container bases and
published deployment references are pinned by immutable digest in addition to
human-readable version tags.

The server runs as a non-root user with a read-only root filesystem. Only
explicit configuration, temporary-runtime, and persistent-data mounts may be
writable, with the minimum required ownership and permissions.

Compatible forward database migrations run automatically during controlled server
startup. Before migration, the deployment creates and verifies a pre-migration
backup. A migration classified as destructive, incompatible, or requiring manual
operator decisions refuses automatic startup and provides an explicit documented
administrative procedure. Concurrent server instances use a database migration
lock so only one migrator runs.

The unauthenticated liveness endpoint returns only a minimal healthy/unhealthy
signal and no version, dependency, tenant, database, or configuration details.
Readiness and diagnostic detail require authenticated administrative access.

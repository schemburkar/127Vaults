# Development-helper verification evidence

This is the single evidence record for `scripts/dev.mjs` and the experimental
container workflow. Tests used disposable or synthetic data unless stated.

## Verification matrix

| Date | Environment | Check | Result and preserved evidence |
| --- | --- | --- | --- |
| 2026-09-06 | Windows, Node 24 | JavaScript workspace | `pnpm check` passed across all seven packages. |
| 2026-09-06 | Ad hoc HTTP | Routing and policy | Liveness 200; unauthenticated readiness 401; unavailable database 503; invalid Host, Origin, forwarded headers 403; missing route 404; wildcard IPv4/IPv6 and public IPv4 startup refused. |
| 2026-09-06 | Podman 5.8.3, podman-compose 1.5.0 | Container deployment | Image built and stack launched; authenticated PostgreSQL readiness returned 200. Inspection confirmed user `node`, read-only root, loopback-only publication, and no PostgreSQL host port. |
| 2026-09-06 | Running disposable stack | Persistence and shutdown | A disposable SQL marker survived database restart and was removed afterward. Idle server SIGTERM exited 0; readiness returned 200 after restart. |
| 2026-09-06 | Running disposable stack | Loopback policy | `localhost`/`127.0.0.1` liveness returned 200; foreign Host and mismatched Origin returned 403; `podman healthcheck run` passed. Liveness intentionally remained healthy with an uninitialized schema while authenticated readiness returned 503. |
| 2026-09-06 | Existing Podman installation | Helper lifecycle | `dev:up` succeeded. `dev:down` followed by `dev:status` returned a clear nonzero unreachable result. Restart preserved installation UUID and `.env` hash. |
| 2026-09-06 | Isolated copies under `%TEMP%` | Strict `.env` parsing | Malformed and duplicate settings failed before Podman discovery with exit code 1. Pre/post SHA-256 hashes proved fixture files were unchanged. |
| 2026-09-06 | Isolated altered copies | Missing dependencies | Missing Podman and missing Compose-provider paths returned the intended diagnostics without invoking installed containers or infrastructure. The Podman standard-install lookup was disabled only in the missing-Podman fixture. |
| 2026-09-06 | Isolated function smoke | Timeout | A 60-second child with a 100 ms helper timeout reported the timeout and accepted termination. The two-second grace path, resistant child, and independent-grandchild cleanup were not exercised. |
| 2026-09-06 | Isolated function smoke | Redaction | A failed child printed synthetic credential assignments and a PostgreSQL URL. Captured errors contained redaction markers and no raw or URL-encoded fixture secret. |
| 2026-09-07 | Windows source-path review and `%TEMP%` fixture | Fresh credential generation | With no fixture `.env`, `up` exclusively created exactly two distinct 64-character lowercase-hex settings. Existing files are parsed but never rewritten; `status` and `down` do not create them. |
| 2026-09-07 | Windows with empty fixture `PATH` | Standard Podman discovery | The copied unmodified helper found installed Podman through the standard Windows path. Read-only engine/machine probes then failed before any machine-start command. |
| 2026-09-07 | Source-path review | Provider and VM selection | Provider order is workspace-local `podman-compose`, then `podman compose`. Only `up` may initialize/start `podman-machine-default`; a nonempty machine list lacking that default is refused rather than guessed. |

`node --check scripts/dev.mjs` passed in both review rounds. No automated unit
tests were added by these checks.

## Evidence boundaries

- No genuinely clean Windows VM was available. First-install Podman machine
  creation, provider discovery, credential preservation across failure/rerun,
  readiness, and non-destructive shutdown still need end-to-end acceptance.
- Docker Compose automation remains unverified.
- The termination-resistant-child grace path and cross-platform process-tree
  cleanup remain unverified; independently spawned grandchildren cannot be
  guaranteed to terminate.
- Redaction covers loaded values, URL-encoded equivalents, recognized credential
  assignments, and PostgreSQL URLs. It cannot recognize arbitrary transformed,
  fragmented, or unknown secrets.
- The isolated helper checks did not build images or touch repository `.env`,
  databases, volumes, machines, or running containers.
- Container migrations, automatic pre-migration backup, active-request shutdown,
  and deferred security cases remain pending.

## Required clean-machine acceptance

On a disposable Windows VM with no `.env` or Podman machine, install the chosen
Compose provider and run the documented workflow. Confirm credentials survive a
failed and successful rerun, only the default machine is created, provider
discovery succeeds, authenticated readiness passes, and shutdown retains data.

Operational commands and current limitations belong in the
[experimental development runbook](experimental-development.md), not here.

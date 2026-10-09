# Recipient installer preflight evidence — 2026-10-09

Scope: the self-contained server bundle launcher in `deploy/install.mjs`.
This is implementation and local Windows evidence for SRV-012, not clean-host,
Docker, Linux server, TLS trust, restore, or public-release acceptance.

## Behavior

- Doctor reports bundle, Node, installation identity, engine executable,
  engine connection, and Compose independently, with failure guidance.
- External probes use asynchronous child processes, bounded output and
  15-second deadlines. A timed-out probe is terminated and its streams closed.
  Engine output and configuration/key contents are not included in reports.
- `doctor --json` emits one redacted format-1 report and exits nonzero when
  prerequisites fail. A failed check never invokes the install operator.
- Options reject unknown/duplicate flags, missing values, malformed/private-IP
  violations, private directories inside the bundle, and Docker/Podman-provider
  mismatches before setup actions.
- Existing `.env` and identity metadata are checked before setup/start. Conflicting
  endpoint/private-directory options and missing/empty identity files fail safely.
  A validated existing custom identity path is passed to the operator when omitted
  by the caller. Setup preserves existing configuration and awaits init, start,
  and status sequentially. A failed step stops the sequence.
- Stop and status do not require a complete identity, allowing operator inspection
  and shutdown; they still require verified bundle and working prerequisites.

## Automated validation

- `node --test deploy/install.test.mjs`: 17 passed. Covers injected missing,
  failed and timed-out prerequisites, Windows provider discovery, argument
  boundaries, redaction, identity preservation and setup sequencing. Real child
  processes prove missing-executable/nonzero-exit/timeout behavior. A copied
  standalone installer proves JSON output and failure exit status without a
  source checkout or complete bundle.
- `pnpm test:packaging`: 28 passed, including recipient installer tests and
  release verification, immutable source snapshots, cache invalidation and
  failed-release handling.
- `node --test deploy/*.test.mjs scripts/ops/*.test.mjs`: 27 passed, including
  installer, license/revocation, backup envelope and schema recognition tests.
- `pnpm check`: passed all workspace syntax/type/build checks, desktop Cargo
  check, and API contract TypeScript check.
- `git diff --check`: passed.

## Read-only existing-host check

Ran the new diagnosis against the existing Windows self-host smoke bundle with
its explicit Podman Compose executable. Node 24, existing identity metadata,
Podman executable and engine connectivity passed. The older bundle lacked the
current launcher's required manifest entries and was correctly rejected. The
selected Compose executable failed its version check; a direct version command
confirmed a missing Python `podman_compose` module. The report distinguished both
failures from the reachable engine and did not emit the Python traceback or
private configuration. No images were loaded, containers started/stopped, keys
generated, or installation files changed by diagnosis.

No fresh bundle was rebuilt or installed in this work. Target-host acceptance,
working Docker/Linux providers, certificate/key validity, filesystem permissions,
backup recovery and independent release/security gates remain open.

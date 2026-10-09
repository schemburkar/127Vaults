# CLI trusted-device management evidence

Checked 2026-10-09 on Windows and Ubuntu 24.04 under WSL. This implements the
device-management portion of CLI-006; credential rotation and release host
acceptance remain open. See the [CLI walkthrough](../product/cli-mvp.md#trusted-device-management).

## Delivered behavior

- `device list` and `device inspect CODE` return JSON through the existing online
  unlock agent. Inspection exposes the enrollment/device UUID, expiry and SHA-256
  fingerprint, without raw keys, account identity or session credentials.
- `device approve CODE --device-id UUID --fingerprint HASH` compares the new
  client's full identity, asks for confirmation, then re-inspects before signing
  the existing canonical approval binding. A changed enrollment, device or key
  fails before the signature is sent. `--yes` bypasses only the prompt.
- `device revoke UUID` checks account membership, active status and current-device
  identity before confirmation. UUID normalization closes the shared desktop/CLI
  uppercase self-revocation bypass. Revocation invalidates server sessions; it
  does not erase offline encrypted replicas.
- Enrollment prints the proposed UUID and fingerprint to stderr, bounds polling
  with a monotonic deadline, rejects unexpected responses and verifies the
  original enrollment/device/key/expiry binding. The desktop callback API remains
  compatible. Successful management command stdout remains JSON.
- Read-only connector agents and the browser native host deny all four management
  actions before dispatch. Rotation commands are not exposed.

## PostgreSQL defect and regression coverage

An owner revoking another device previously issued an unconditional account
recovery-state UPDATE. Even when the value stayed `available`, the frozen
ownership guard rejected that UPDATE and rolled back revocation. The store now
updates recovery state only when it differs and writes the accepted revocation
audit record in the same transaction. No schema or ownership-guard changes were
needed.

The disposable database test installs the current schema and proves the original
no-op owner UPDATE is still blocked, while owner revocation succeeds. It checks
cross-account denial, wrong approval/possession signatures, pending/approved
polling, completion, replay denial, target-session invalidation, preservation of
the current/other account sessions and owner role/recovery state, and
the accepted audit subject.
The fixture starts with no private items and verifies that none are introduced;
it does not establish ciphertext preservation for a populated vault.

## Verification

| Check | Result |
| --- | --- |
| Windows `cargo test --workspace` | CLI: 57 passed, one fixture-only test ignored by default; crypto/protocol/browser fixture tests passed |
| Windows `cargo clippy --workspace --all-targets -- -D warnings` | Passed |
| Windows CLI binary build and device/approve help | Passed; required identity flags displayed |
| Ubuntu 24.04 WSL `cargo test -p vaults-cli --lib` | 57 passed, one fixture-only test ignored by default |
| Ubuntu CLI all-target Clippy with warnings denied | Passed |
| `pnpm check` | Passed, including desktop/web production builds and contract TypeScript |
| `pnpm test` | Passed; database-dependent tests skip in the ordinary environment |
| `pnpm test:device-management --rust` | Passed without skips against disposable PostgreSQL 17 and pinned-CA HTTPS |

The Rust HTTP tests exercise real Session requests, cookies, Origin/CSRF headers
and Ed25519 signature verification. They reject substituted identity and
401/403/409/429/503 responses without reporting success or leaking server details.
Windows fixture sockets explicitly use blocking reads and bounded timeouts.

The `--rust` acceptance command builds the CLI test binary, creates an ephemeral
CA/server certificate, and runs the normally ignored Rust ceremony through the
production enrollment/device handlers backed by the actual PostgreSQL stores.
It covers request signature, pending poll, fingerprint mismatch refusal,
reviewed approval, approval-signature verification, possession proof, completion,
active listing, replay rejection, normalized self-revocation refusal, target
revocation and revoked listing. The Node fixture checks the resulting database
state and audit record. The container uses a random loopback port and in-memory
data; certificates, keys and the database container are removed afterward.

## Remaining acceptance

The live fixture supplies a preauthenticated session. It does not verify OPAQUE
login, OS keyring behavior, actual two-agent terminal interaction, disconnected
client locking, clean-machine installation or a packaged release. Ubuntu testing
uses the shared source through `/mnt/c` with a separate Linux Cargo target.
Docker is an unverified alternate runner; the executed fixture used Podman and
locally available images without pulling. Credential rotation remains blocked
on completion of the server ceremony and recovery contract.

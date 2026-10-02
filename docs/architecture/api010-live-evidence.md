# API-010 live acceptance evidence

On 2026-09-23 an isolated Podman acceptance stack enrolled two distinct
devices against one account. `apps/cli/examples/api010_acceptance.rs` exercised
the real CLI session, encrypted replica, and v1 server endpoints.

The exercise passed these scenarios:

- An online stale edit changed a different field and rebased to convergence.
- A same-field conflict preserved the pending signed operation through restart;
  a reviewed replacement converged.
- An offline queued edit met a remote edit, rebased, and converged. Retrying its
  operation ID was idempotent.
- A signed checkpoint was verified and pinned on the second device.
- Replica files contained ciphertext without the test item plaintext.
- Revoking a device left its queued request and last verified item readable
  offline, while online authentication failed.
- Tampering with a server operation signature caused verification to fail
  without changing the last verified local replica.
- An offline create from a stale catalogue rebased and converged.

The desktop merge UI consumes the engine's structured conflict marker and has
focused tests. Delete/edit divergence is represented and blocks further edits;
end-user resolution of that divergence awaits a supported delete command.

The isolated stack was stopped without deleting its volume. The original
`vaults-acceptance` database and server were restored afterward.

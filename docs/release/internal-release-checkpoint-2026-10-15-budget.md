# Stop checkpoint: interrupted Desktop budget rehearsal

Internal release remains INCOMPLETE. Stopped at the user's request because usage
is low. Resume only when the user restarts the goal. No remote push.

## Current state

The selected Linux Desktop production UI accepted 298 genuine offline encrypted
edits of the existing synthetic member item. Saves slowed as the queue grew.
The fixture inspector command timed out before the session encryption budget
guard was reached. This is NOT passing budget/recovery evidence. The cause of
the timeout and whether the auxiliary stop inspector contributed remain unknown.

The app and budget helper processes are stopped (no matching processes at the
checkpoint). Selected server project `vaults-test-632a4442dfd2` is stopped with
its retained volume. Original project `vaults-test-a0540f7d9c99` remains running,
both services healthy. No queue reset, profile replacement or server-data reset.

GUI profile:
`/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/gui-member-server-a-20261015-a`.
Authoritative replica: `replicas/05a72b81-830d-48ab-bc22-e85970c47ea8.json`.
Checkpoint observed **298 pending requests, zero conflicts**. Exact private
replica snapshot beside it: suffix `.stop-checkpoint-1792079551241`, mode 0600.
Whole-file SHA-256:
`2eb5b8520debe15b3ffa572203899e4b746c894b44f406b2a354afc6cc490245`.
Do not expose private replica contents or commit fixture credentials/data.

Candidate work directory:
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a`.
Its latest `member-desktop-run-failure-*.log` records the inspector timeout;
the progress file undercounts the final durable queue. No passed budget record
was produced. Newly saved budget helpers and verifier branches are experimental;
syntax checks alone do not validate their full workflow.

## First tasks on resume

1. Recheck processes, exact replica hash/count and retained server identity.
   Preserve the snapshot. Do NOT rerun the burn phase or use a false success
   record to enter recovery. Do not run the original Linux CLI profile alongside
   the GUI: they share the enrolled device identity.
2. Build an explicit partial-run recovery path. Start only the selected server
   with its bundled operator. Launch the exact selected Desktop-c binary under
   the existing private keyring and GUI profile. Unlock normally and replay the
   298 queued requests using the supported UI. Allow sufficient time; preserve
   all requests if replay fails. Never clear queues or resolve conflicts just
   to obtain a pass.
3. Independently verify final title and unchanged secret with the distinct
   Windows member CLI, restore the synthetic baseline through a normal edit,
   and verify with a fresh GUI process. Record actual counts/hashes and check
   empty queues, catalogue, historical peer item and retirement invariants.
4. Only after recovery, rerun the relevant existing acceptance/gap checks.
   Investigate save latency and inspector timeout before designing another
   bounded budget test. LOCAL-01 remains open.

## Remaining release work

Use `internal-release-remaining-gates-2026-10-15.json` and the reconciliation
document for the full scope. Prior real member CLI/web/Linux Desktop conflict
and multiple-pending checks, selected-server restore evidence, and encrypted
missing-item/create-ID-collision component checks remain historical scoped
passes. They do not establish current queue cleanup or full release readiness.

Packaged missing-item/create-ID-collision and other named sync/loss scenarios,
budget recovery, cross-vault/settings/license cases, Windows GUI policy cause,
installed PWA/physical OS behavior, affirmative extension permissions/passkeys,
and intended-host/SMTP checks remain pending where applicable. CLI/Desktop
rebuilds with earlier fixes already exist; rebuild again only if runtime code
changes. Investigate the earlier policy rejection without bypassing it.

Completed work must remain committed to local Git main; never push unless asked.

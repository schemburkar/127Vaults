# Paused checkpoint — October 16, 2026

Historical checkpoint, superseded by [completed deletion and local internal acceptance](internal-functional-readiness-2026-10-16.md). The resume list below describes work that was pending at the pause, not the current implementation.

Stopped at the user's request. Internal release is incomplete: the user explicitly
requires individual private-item deletion. No deletion implementation was made
before this checkpoint. No remote push was performed.

## Completed product work retained

- `cbb1be0`: verify a destination copy before retiring a source vault during move.
- `cd67ab2`: avoid repeatedly loading/decrypting an entire replica during sync review.
- `a574a62`: refresh web/Desktop license notices during unlocked sessions.
- `827a50b`: select server/web-b, Desktop-e, CLI-b and extension-a packages for the
  earlier functionality-first trial. Those packages do not implement item deletion.

Internal scripts were reorganized into categorized `tests/internal` suites.
Existing basic checks passed before the new deletion requirement; they are not
evidence for a deletion feature. Retain the existing functional-readiness record
for the detailed check scope and limitations.

## Resume next

1. Implement authenticated item deletion through encrypted catalogue/Core and WASM,
   server transaction/history/receipt handling, native client and CLI, Desktop and
   web actions. The current private-item handler supports GET/POST/PUT only.
2. Handle offline queues, restart/retry, delete-versus-edit conflicts and stale
   readers without silent resurrection or loss of another pending draft. Inspect
   existing `item.delete` protocol support before choosing the transaction design.
3. Add focused regressions in existing product suites and run basic functional
   sanity. Use new disposable synthetic items; preserve all retained fixture items,
   encrypted queues, backups and revocation records.
4. Commit completed code to local `main`, rebuild affected packages from that
   committed revision, and update release evidence. Do not push.
5. Investigate the earlier Windows GUI launch rejection separately. Its reported
   text was `CreateProcess rejected: blocked by policy`; its source is unknown.
   Do not infer a user policy or bypass it with another launcher.

## Useful starting points

- `crates/crypto/src/ecf1.rs`: private-item upsert/catalogue operations.
- `crates/browser-fixture/src/lib.rs`: browser Core bindings.
- `apps/server/src/private-vault-handler.mjs`, `private-vault.mjs`,
  `private-vault-pg.mjs`: route and storage transactions.
- `apps/cli/src/client.rs`, `replica.rs`, `lib.rs`: mutations, replay and commands.
- `apps/desktop/src/app.tsx` and `src-tauri/src/main.rs`: Desktop actions.
- `apps/web/mvp-client.mjs` and `src/pwa-replica.mjs`: web actions and replay.

The isolated server-b fixture at
`C:/Projects/127Vaults-license-isolated-20261015-a` was stopped after its last
sanity run. Use its `extracted-b` bundle if needed, never the older extracted A.
Check license validity before writes. Intended-host, physical installation,
CA-trust, OS-lock and SMTP acceptance remain separate user follow-ups.

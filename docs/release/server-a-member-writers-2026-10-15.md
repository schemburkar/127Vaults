# Selected server-a cross-OS member writers — October 15

Selected Windows/Linux CLI-a (`600f206`) completed bidirectional online member
writes against selected server/web/admin-a (`cbb1be0`, image `4bfc4bf6`). Both
profiles were genuinely enrolled through the actual member web UI in previous
checkpoints; they are distinct randomly generated devices. This adds native
writers to the selected-server evidence. Full internal release remains unaccepted.

The four sequential actual packaged-command phases passed:

1. Windows synced the original web-created moved item, verified fields, masked and
   explicit password, and changed its title through `item edit`.
2. Linux synced and read that exact Windows title, then edited the username while
   preserving title/website/password.
3. Windows synced and read both the Windows title and Linux username, then
   restored the original title and username.
4. Linux synced and independently verified the original fields and explicit
   password again. Both client replicas finish with empty queues/review.

Each phase checked the six-item destination catalogue and the unchanged title of
its historical destination-copy peer edit. Each attempted an actual edit of the
retired source item and received `retired vault is read-only`. No vault/item was
created/deleted; retired source and all existing destination items remain. Normal
history advanced through the three accepted edits; history was not rolled back.
The worker refuses unrelated pre-existing pending requests/removal journals and
requires the expected phase-specific fields and empty custom fields before writes.

The exact extracted CLI bytes are checked against the previous selected-archive
hashes; the orchestrator asserts the actual selected server image. Linux runs in
a private D-Bus/keyring session. Each agent locks/stops after its phase. The
combined check confirms no member CLI processes on either OS, stopped owned
candidate project, original 12892 health, exact bundle/wiring and unchanged
revoked-device D encrypted pending copy/removal journal. Existing enrollment,
admin, native-reader and destination P1 checks also pass.

An initial helper attempt supplied no stdin to its JSON command wrapper and was
refused by CLI parsing before any edit. The wrapper was corrected; all four phases
then passed. This was test-helper wiring, not a product defect. Failed diagnostics
remain private. The successful phase record is retained and must not be reset or
blindly rerun; its initial phase intentionally refuses an existing record. If a
future phase fails, inspect current item/journal state rather than overwriting
fixtures or resubmitting an already accepted phase.

Evidence directory:
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a`.
Records: `member-cross-os-writes.json`, `member-writes-combined-evidence.json`.
Retained enrolled profiles are those in the Windows/Linux member enrollment notes.

Reverify records and cleanup without repeating mutations:

```powershell
node scripts/internal-member-acceptance-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a --writes
```

Helper syntax and combined checks pass. No runtime/source release artifact changed
and nothing was pushed. This is online sequential ordinary-field interoperability;
concurrent/interrupted writers, additional Desktop/web/extension pairings, current
Windows GUI, physical/PWA/keyring/OS-lock and intended-host operations remain open.
No Windows GUI policy or native-host registration was changed.

# Selected server-a member web/native writes — October 15

Selected server/web/admin-a (`cbb1be0`, image `4bfc4bf6`) and Windows CLI-a
(`600f206`) pass an actual member web edit → packaged native read/restore →
restarted web read flow. Full internal release remains unaccepted.

The genuinely enrolled browser unlocked through OPAQUE, selected the existing
active destination and opened the web-created moved login. Actual Edit/Save
changed its title. The selected packaged Windows CLI on its independently
web-approved random device synced and read that exact title, unchanged ordinary
fields and masked/explicit password, then restored the original fields through a
normal accepted edit. A separately launched browser process/context unlocked and
read the restored title, username and website, masked then revealed the password,
verified six destination items and retired source, and locked. The native phase
also preserved the historical destination peer-edit title, refused an actual edit
of the retired source, and finished with no queued items/conflicts.

The first web helper incorrectly watched the move-copy `/items` endpoint for an
ordinary edit. Ordinary editing uses `/operations`; the real operation returned
200 and the UI showed the changed title, but the helper stopped before writing its
success record. The browser was closed. We did not repeat the save or reset data.
A guarded recovery required the original failed transcript with its sole actual
200 operation response, then restarted/unlocked the actual app and read the saved
changed title without mutations. The independent native read subsequently proved
that same edit reached server history. The observed response lacks the request-ID
and body-hash capture; this is explicitly not exact receipt-replay evidence.
The helper now observes the proper endpoint; recovery records name the original
failed transcript and distinguish read-only recovery from a new write.

The original item's ordinary fields/password and empty custom fields are restored.
No vault/item was created/deleted; history advanced through accepted edits. The
retained cross-OS native record remains valid. Do not reset/re-enroll member
profiles or blindly rerun the successful mutation phases. Helpers guard existing
records, expected fields, phase order and unrelated native pending/removal state.

Evidence directory:
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a`.
Records: `member-web-native-writes.json`,
`member-web-native-combined-evidence.json`. Private original failure transcript is
referenced by the phase record. Current combined verification also checks native
member enrollment, Linux persisted-key restart, bidirectional native writes,
selected hashes/image records, destination P1 and exact original/revoked-data
preservation. Member processes and browser container are absent; owned candidate
project is stopped, original 12892 remains healthy. Browser was locked before exit.

```powershell
node scripts/internal-member-acceptance-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a --web
```

Changed/new helper syntax and combined checks pass. No runtime release artifact
changed; no push or Windows GUI policy/registration change. This is headless
Linux Chromium with production assets/WASM/IndexedDB and strict-CA real transport,
not physical/installed-PWA acceptance. Concurrent/interrupted writes, additional
Desktop/extension pairings, Windows GUI and intended-host operations remain open.

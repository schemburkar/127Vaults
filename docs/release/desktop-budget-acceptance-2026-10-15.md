# Actual packaged Desktop session-budget acceptance

LOCAL-01 passes for the selected Linux Desktop GUI/member fixture. Internal
release remains unaccepted; other platform/error pairings and the remaining
scenario families and named gates are not implied complete.

Selected CLI-b and Desktop-d for Windows/Linux were rebuilt from committed
`cd67ab2c224df758f173fd393590c4586386f8b8`, containing the queue-review cost fix.
All four manifests/file sets verify. Build workflows passed Desktop type/native
checks and automated tests, CLI library checks (84 passed, one existing explicit
live-fixture test ignored), installer packaging and native-host framed discovery.
Windows GUI launch acceptance remains separately unproven.

The exact extracted Desktop-d Deb executable was verified against the package
and used with the retained genuinely enrolled Linux member profile/keyring.
The server was stopped for the burn and retry phases. The actual Edit/Save UI
accepted **500** encrypted edits within one unchanged production Core session.
Attempt 501 displayed `Encryption session limit reached`, lock/unlock/retry
guidance, and confirmation that queued edits are preserved. Before/after pending
requests matched exactly. The UI cancelled the unsaved edit and explicitly locked.

A fresh app process unlocked offline and successfully saved that refused edit.
All 500 original requests remained an exact prefix, with a correctly linked new
operation. After the selected server restarted, the actual GUI replayed all
**501** requests with zero pending/conflicts. Separate rebuilt Windows CLI-b
verified the final title and original synthetic secret, then restored baseline
through a normal edit. It checked the six-item destination, historical peer
edit, retired source and refusal to edit that source. Its verified cursor was
829. A fresh Desktop-d process read baseline fields with the secret masked and
locked. Rebuilt Linux CLI-b subsequently verified the same baseline, explicit
synthetic secret, full history and catalogue/retirement invariants using its
original enrolled profile after GUI shutdown.

The burn started at 16:06:25 UTC and reached 500 at 16:09:07 UTC on October 15.
The original run had timed out near 298 after several minutes; this is scoped
performance evidence, not a general latency guarantee. No budget lowering,
native mock invocation, queue clearing or profile replacement was used.

Private authoritative records under
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a`:

- `member-desktop-budget.json` and `member-desktop-budget-combined-evidence.json`.
- Original/retry encrypted request snapshots (kept outside Git).
- `member-rebuilt-cli-linux-read.json` and `member-budget-cli-package.json`.

`node scripts/internal-member-acceptance-verify.mjs <candidate-work> --budget`
passes the full existing scoped evidence chain plus actual budget request hashes,
IDs, predecessor links, runtime binary/revision, all five phases and cleanup.
The gap audit now also binds the new runtime records to selected artifact
revisions. Selected server stopped with volume retained; original server healthy;
all relevant queues empty and owned test processes stopped. No remote push.

Next local priorities are packaged collision/chained queue coverage, applicable
missing-item GUI defense, wider settings/default-view divergence, and actual
signed-license state/renewal retention. Intended-host details remain requested;
permission/physical/policy gates remain explicit in the ledger.

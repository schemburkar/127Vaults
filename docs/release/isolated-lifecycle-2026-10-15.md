# Isolated lifecycle acceptance — October 15, 2026

The original 12892 installation already contains five retained vaults. Move tests
there would retire an existing fixture. A new installation was provisioned from
the selected server-e release into
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a` instead.

- Installation: `98027ac4-9882-42d5-812a-a18c972c299f`.
- Project: `vaults-test-632a4442dfd2`; separate PostgreSQL volume and private CA.
- Client test origin: loopback `https://127.0.0.1:12898` only. Fault proxy upstream
  temporarily uses host 12899 while the server retains internal port/origin 12898.
- Server source: `ee83e2d1363fccdd4d031e6cf3cd928b1ef7d361`, selected server-e
  image verified by ID. Only fixture Compose listener/PORT and manifest checksum
  differ from the extracted release. No product image modification.
- Packaged Windows CLI: `internal-20261015-a`, source `600f206`; two distinct
  devices of the new fictitious `owner_127` account use actual Windows keyring keys.

The source `api010_acceptance` helper gained an explicit enrollment-only mode for
an absolute new external client root. It establishes CA/server trust, adopts only
the deterministic fictitious first-owner device key, enrolls a distinct device
and unlocks both, then stops before historical mutation scenarios. Existing keys
with a different value are refused. Provisioning is source-helper evidence;
subsequent lifecycle operations use the immutable packaged CLI.

Initial fixture setup errors were preserved and corrected: the pristine archive
uses port 12780, not the earlier copied fixture's 12894; fresh installation ID
comes from the started database's operator identify command, not a restored
identity's installation-id file. The first card input incorrectly used a text
marker instead of metadata; the corrected fixture resumes only its checked
partial baseline. A subsequent expected URL lacked the CLI's normalized trailing
slash after the move had succeeded. Verification resumed that completed move
without resubmitting it. These failed setup/assertion attempts are not product
failure or passing evidence, and their logs/data are retained. No reset or deletion
was used to repair a test.

## Required new cases

| Case | Required evidence |
| --- | --- |
| Normal move | Login/card copies exactly once, peer field/secret verification, collection de-duplication and default-view retargeting; retired source keeps originals, refuses edits and archive-only restore |
| Accepted copy reply lost | Durable journal/reserved destination ID and exact encrypted pending request survive agent restart; receipt replay makes one copy and finalizes once |
| Accepted finalization reply lost | Durable final request survives restart after server retirement; exact receipt replay clears the journal with no duplicate copies |
| Cross-OS reader | Newly enrolled Linux device reads all four final copies and retirement/default state using the selected packaged Linux CLI |

Final outcomes and evidence index follow after verification. Broader Desktop/web,
reverse-writer, ownership, physical and original release gates remain separate.

## Windows outcomes verified

The normal move and both interruption cases pass against selected server-e with
the immutable Windows CLI-a. Distinct Windows device B verifies exact field and
secret preservation and one copy per title. Copy and finalization each have two
upstream HTTP 200 responses: the first accepted reply is dropped, then a new agent
replays the same request ID and SHA256 body. The copy operation ID also matches.
Reserved destination IDs and the complete removal journals survive restart;
final requests clear only after receipt verification. The final destination has
four copies, with no duplicates; all three source vaults are retired.

Evidence: `move-evidence.json`, `proxy-evidence.json` and `evidence.json` under the
fixture workspace. Original/retry runners and failed logs remain there. The proxy
was removed, the new project stopped, and its exact environment restored. The
original 12892 installation was neither stopped nor modified. A Linux reader run
is recorded below when complete.

Source helper checks: Rust example Clippy and format check pass; both JavaScript
helpers pass syntax checking and actual fixture execution. Enrollment-only mode
rejects a relative root before creating a profile or touching the keyring. No
product runtime code changed; selected artifacts remain unchanged.

## Cross-OS reader and completion boundary

The newly enrolled Linux device passed `all-peer` using selected Linux CLI-a:
all four destination IDs, titles, ordinary fields, card markers, masked secrets,
explicit login/card secrets, all three retired sources, synchronized default and
empty local queue were verified. Linux enrollment used the source helper on a
private D-Bus session with the retained fictitious keyring; the read operations
used the immutable packaged Linux binary. Both OS package manifests/file hashes
and the exact replay evidence pass the combined verifier.

Combined evidence is
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/combined-evidence.json`.
`linux-peer-evidence.json`, `verify-all.mjs`, `run-linux.mjs` and `linux-peer.sh`
record the cross-OS path. Source enrollment and native keyrings are explicitly
separated from physical installation or GUI acceptance. The isolated project is
stopped with its five vaults/data retained; the original 12892 server/database
remain running. No remote push, public deployment or existing-profile reset.

This closes the packaged Windows-writer normal move and copy/finalization reply
loss subset with Windows/Linux independent readers. It does not close Desktop/web
move UI, Linux writer, changed-source/destination, abort/keep-copies, authorization
loss, ownership or physical gates. Remaining active synthetic data may support
further interruption scenarios; use a new isolated project if extra vaults are
needed, since this lab now also contains five directory entries. Preserve failed
runs and original journals rather than resetting either installation.

## Source/destination changes and abort subset

New selected-package Windows cases pass with independent Windows/Linux readers:

- During accepted-copy reply loss, a peer changes the source. Exact copy receipt
  replay succeeds after restart, then move refuses the changed source, retains
  the original journal and leaves the source active. Explicit abort retains both
  the original copy and newer source data.
- During another accepted-copy reply loss, a peer edits the destination copy.
  Replay succeeds, but move refuses to retire the source over a changed copy.
  Abort preserves the peer's destination edit, the source and all earlier copies.
- Abort before receipt replay preserves the exact still-pending encrypted copy
  request. A new agent's ordinary sync replays that request byte for byte,
  clears only the pending copy and never retires the source or recreates the
  removal plan. Independent readers verify seven destination records.

The remaining active Private vault is owned by this new lifecycle lab, not the
retained 12892 installation. Its single synthetic MVP item was checked as Race A/B
with its known fictitious password and edited through the actual CLI into a full
login record for these cases. Its later peer edit is deliberately retained. No
existing user item, old installation or original release fixture was normalized,
retired, reset or deleted.

`guard-evidence.json`, `guard-summary.json`, `guard-proxy-evidence.json`,
`guard-linux-evidence.json`, `early-abort-summary.json`,
`early-abort-proxy-evidence.json` and `early-linux-evidence.json` are retained in
the isolated workspace. Each dropped copy reply had one matching HTTP-200 receipt
replay with identical request ID, operation ID and SHA256 body. Source, destination
and pending-copy preservation are checked separately. Linux readers use existing
independently enrolled device C and the immutable selected CLI; no source client
is substituted for packaged operations.

Runners stop only the isolated project and restore exact environment values.
Historical four-copy acceptance remains a point-in-time result before these
intentional additional copies; do not blindly rerun its fixed-count assertions
against the now-expanded lab. Broader UI/reverse-writer, ownership and physical
acceptance remain open. Actual revocation-during-move evidence follows separately.

## Actual revocation during an interrupted move

A new disposable device D was enrolled solely for this case. It accepted one
copy, lost the reply, and retained a copying-stage journal plus one pending
request. Existing trusted Windows device B then revoked D using the packaged
CLI and the real TLS/PostgreSQL device endpoint. This is actual revocation,
not an injected 401. Owner writer A and Windows/Linux peers remain active; no
device in the retained 12892 installation was changed.

Restarting D falls back to encrypted local unlock with `online:false`,
`authenticated:false`, `unlocked:true` and an authorization-refusal reason.
Its complete journal bytes and exact pending encrypted request survive; masked
sync review remains available without exposing either fixture secret. Move and
sync refuse while offline and preserve the same records. Nothing retires the
source. Trusted device B still verifies the revoked device's signed history and
reads the accepted copy with ordinary fields, masked and explicit secrets; the
new destination count is eight intentional records across all staged attempts.

D's reason is currently `server rejected request (401)`, not a device-specific
re-enrollment explanation. More actionable wording is a UX follow-up; this test
proves authorization refusal, truthful offline status and work preservation.
The revoked profile, keyring entry, journal and pending request are deliberately
retained, not reset or reactivated to make a test pass. Each earlier case is a
point-in-time result: later intentional copies change fixed-count assertions.

Records: `revocation-evidence.json`, `revocation-summary.json`,
`revocation-proxy-evidence.json`, `run-revocation.mjs` and source enrollment
profiles under `clients-revocation`. Proxy evidence contains exactly one
upstream HTTP-200 copy with a dropped reply; revoked move/sync sends no copy
retry. Linux history/read verification follows in its own evidence record.

### Linux verification and retained state

The selected packaged Linux CLI independently verifies the post-revocation copy,
its fields/secrets and still-active source. This includes verification of device
D's signed operation after D is revoked; historical verification keys are not
lost. `revocation-linux-evidence.json` and the final peer OS/device in
`revocation-evidence.json` record the actual reader.

The combined verifier checks all six Windows/Linux case summaries, three pairs
of exact receipt replays, the single accepted-but-unretried revoked copy, the
revoked profile's still-identical journal bytes and pending request, both immutable
CLI package manifests and restoration of all three environment snapshots.
Combined index: `guard-combined-evidence.json`; repeatable verification:
`verify-guards.mjs`. New runs and shells are `run-guards.mjs`, `run-linux-guards.mjs`,
`run-early-abort.mjs`, `run-linux-early.mjs`, `run-revocation.mjs` and
`run-linux-revocation.mjs`, with their private-bus shell scripts.

All new cases passed without a product runtime change. Source fixture helpers
pass JavaScript syntax checks and actual packaged execution. Only the new
isolated project was stopped and its exact environment restored. Revoked D stays
revoked with its original queued work intact; owner A and peer B/C stay trusted.
The retained 12892 installation remains healthy. No push or public deployment.

Current remaining lifecycle scope is other writers/UI pairings, ownership,
finalization-stage abort refusal and broader authorization/expiry combinations,
plus the original physical/intended-host gates. The Windows CLI divergence,
keep-copies/early-abort and actual revocation subsets above are now proven; older
open statements in this chronological document describe earlier checkpoints.

## Linux writer, finalization abort refusal and actual GUI reader

Selected packaged Linux CLI-a, on independently enrolled device C, moved the
remaining active synthetic Private source into the lab destination. The accepted
finalization HTTP-200 reply was dropped after server retirement. On restart,
`abort-move --keep-copies` refused the finalizing request and kept the complete
journal byte for byte. A new process replayed the same request ID and SHA256 body,
verified the receipt and cleared the journal. Distinct selected Windows CLI-a
reads the reserved destination ID, ordinary fields and built-in/custom secrets;
the destination now has nine deliberate records across the staged attempts.

Actual selected Linux Desktop-c then unlocked a copied C profile against selected
server-e, opened the unique retained destination-peer edit, verified username,
website and custom-secret label, masked both secrets by default, explicitly
revealed and remasked each through real React buttons/native backend, and locked.
No clipboard copy, native-command mock or direct invoke was used. The fixture
helper's new-lab opt-in permits only this guarded read/lock mode and checks the
lab identity, project, origin, writer device and expected title before inspector
access. It does not enable mutation scenarios on arbitrary profiles.

Evidence: `linux-final-evidence.json`, `linux-final-summary.json`,
`linux-final-proxy-evidence.json`, `gui-read.json`, `gui-read-summary.json` and
`linux-final-combined-evidence.json`. Runners and shells are `run-linux-final.mjs`,
`linux-final.sh`, `run-gui-read.mjs` and `gui-read.sh`; `verify-linux-final.mjs`
checks all phases, exact replay, package hashes, restored environment and D's
still-identical revoked journal/pending request. The lab is stopped, original
12892 remains healthy, and no existing data or revoked draft was reset.

All four lab sources are now retired, leaving only the destination active. The
five-entry directory is full; use another fresh isolated account/project for
future move-UI or additional writer/fault scenarios. Finalization-stage abort
refusal and this Linux-writer recovery subset are now proven. Remaining scope
includes move UI, other writer/fault pairings, ownership and original physical /
intended-host acceptance. No product runtime or selected artifact changed, and
no push or public deployment occurred.

## Ownership API and private-data isolation

The selected server now passes the [real ownership acceptance flow](ownership-acceptance-2026-10-15.md),
including genuine invited-member onboarding, session revocation, idempotent receipt
replay, last-owner protection and cross-account vault denial. Original owner role
is restored after demotion, with a selected Windows CLI secret read during the
demoted interval. The new member remains a user with an empty private directory.
The ownership browser UI/stale-auth and broader lifecycle/physical gates remain
open. Cleanup and D's revoked pending draft/journal pass the retained verifier.

## Actual selected web normal move UI

Selected web-e now passes a normal move through its actual React/DOM controls,
using the genuinely invited `ownership_member` account and its retained enrolled
browser profile. The account's empty directory supplied new slots without
retiring any original owner fixture. Two vaults and a synthetic login were created
through visible controls. Cancelling move confirmation sent no removal; confirming
made one successful destination copy and one successful final removal. The source
became retired with no pending action or archive-restore button. The destination
showed exactly one new item ID, retained ordinary fields, masked its password,
explicitly revealed it and locked through the actual UI.

A different genuinely registered device then authenticated using production
OPAQUE/device proof and independently decrypted both the retained original and
new copy with the exact title, website, username and password. It verified two
directory entries, source retired/destination active and one item in each. This
reader is a Node production-crypto helper, not a packaged CLI/Desktop claim.

The initial profile-label assertion ran before opening Settings, which is when
the app populates that label; no vault was changed in that failed attempt. The
first independent reader hit connection refused immediately after startup; a
bounded setup-read readiness wait resolved the host-port startup race. Failure
diagnostics and partial records remain retained. No product runtime changed.

Evidence under the existing isolated work directory:
`web-move-ui-fixture.json`, `web-move-ui.json`, `web-move-peer.json`, and
`web-move-combined-evidence.json`. Saved runners are `run-web-move-ui.mjs` and
`run-web-move-peer.mjs`. The mutating UI helper refuses an already completed move;
do not recreate the retired source or reset the profile to rerun it. The member
now has two directory entries (one moved source and one active destination), so
older ownership checks requiring an empty member directory are historical and
must not be blindly rerun. Original owner catalogue and revoked D are untouched.

All three new helpers pass syntax checks. Combined verification passes:

```powershell
node scripts/internal-web-move-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a
```

This includes the earlier ownership verifier's exact Compose/manifest/environment
restoration, selected Windows CLI hash checks, stopped owned project, healthy
original 12892 server/database, and preserved revoked D pending request/journal.
The actual browser uses the existing strict-CA HTTPS relay with service-worker
bypass; physical/installed PWA acceptance remains separate. This normal login
subset does not prove web move fault/restart recovery, typed/custom fields,
collection/default retargeting or additional writer/package pairings. Those and
broader physical/intended-host gates remain open; internal release is unaccepted.
No push.

## Actual web accepted-copy loss, restart and resume

Selected web-e now also passes an accepted-copy reply loss through actual UI
handlers. A third controlled vault belongs to the same genuinely enrolled invited
member. The strict-CA relay forwards the real signed encrypted copy to the selected
server, observes HTTP200, then discards only that response. The app shows “Vault
action needs attention” and a Resume control. The durable journal retains the
reserved destination ID, exact request ID and encrypted request hash; no source
removal is submitted in this loss phase. The complete browser process then closes.

A separate process opens the same retained profile, authenticates through the real
login ceremony and verifies its published pending journal equals the complete
saved journal. Visible Resume replays the identical copy request ID/body hash,
obtains the receipt, finalizes retirement and clears the pending action. Exactly
one reserved copy is displayed with its original fields; password masking,
explicit reveal and final Lock pass. This is ordinary-web IndexedDB/profile
recovery, not installed-PWA/offline acceptance.

A distinct registered device independently decrypts the retired original and new
copy, verifies three directory entries, one source item and exactly two destination
items, and confirms the earlier normal-move item ID remains present. Thus the lost
reply/restart did not make a duplicate or replace that prior item. The independent
reader is the Node production-crypto helper, not a packaged CLI/Desktop claim.

Retained evidence: `web-move-copy-loss-fixture.json` (including the full encrypted
pending journal), `web-move-copy-loss.json`, `web-move-copy-resume.json`,
`web-move-copy-peer.json`, and `web-move-copy-combined-evidence.json`. Saved runners:
`run-web-move-copy-loss.mjs loss|resume` and `run-web-move-copy-peer.mjs`. The case
refuses reinjection after loss or resubmission after completion; never clear its
journal/profile or recreate its source to obtain a passing run.

New/updated helpers pass syntax checks. Combined verification:

```powershell
node scripts/internal-web-move-copy-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a
```

This also verifies earlier normal/ownership evidence, exact bundle/wiring
restoration, stopped isolated project/absent owned browser container, original
12892 health, selected CLI hashes and unchanged revoked D draft/journal. Earlier
normal/ownership item counts remain historical snapshots. The member now has
three retained entries (two moved sources, one active destination with two items);
use the explicit `copy-loss` peer mode for current counts. No product runtime or
selected artifact changed, no push. Web finalization loss, changed-source /
changed-destination refusal, typed/custom fields, settings retarget and remaining
package/writer/physical/operational gates remain open. Internal release is still
unaccepted.

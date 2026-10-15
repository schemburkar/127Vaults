# October 15 internal-release continuation

**Internal release remains not accepted.** The user explicitly resumed the goal.
The October 14 stop checkpoint remains historical; this continuation records new
work and does not waive the full seven-surface scope.

## New settings safety evidence

CLI `internal-20261015-a` Windows/Linux packages are built from committed
`600f206ce300e643a0b3d2dfd8259bdde597cb1a`, including the `a65ab45` settings
review revalidation fix. Both build gates passed 78 library tests (one separate
live TLS/PostgreSQL fixture ignored), optimized binaries and framed native-host
discovery.

Actual packaged Windows/Linux agents passed four settings-resolution cases:
each OS chose server and local. Every case first queued a real encrypted settings
edit through an authenticated PUT/503 fault; a distinct OS peer advanced the
real server settings revision. Explicit resolution under GET/401 and GET/403
failed, marked status offline/unauthenticated with encrypted local unlock retained,
and preserved the settings file byte for byte. Healthy restart retained the draft.
A further real peer revision made the old decision fail until comparison was
reviewed again. The updated explicit decision converged on the peer, and original
settings were restored after each case. Item queue values were unchanged; these
new profiles had no pending item edits. Earlier settings evidence separately
covers a nonempty unrelated item queue.

Evidence: `C:/Projects/127Vaults-settings-review-20261015-a/native-evidence.json`,
`native-refusals.json`, `baseline.json`, `verify-native.mjs` and `run.mjs`.
The native evidence pins both complete release manifests and file hashes. All
12 injected responses (four each of 503, 401 and 403) were issued only after real
upstream authentication. This is real pinned TLS/PostgreSQL with controlled fault
responses, not an actual administrative device revocation. The server runtime
remained the retained bundle-d source `103da5b`; selected server-e is unchanged.

Initial attempts failed before scenario mutation because Linux used the default
D-Bus/keyring, which did not hold the enrolled fixture device key. A dedicated
D-Bus session loaded the existing fictitious keyring. No key or profile was
replaced or re-enrolled. Failed attempts and environment snapshots are retained;
only the subsequent complete four-case run is claimed passed. Each runner restores
the exact server environment and original 12892 mapping in its finalizer.

## Desktop follow-through

Source commit `5312a349b45e2aa08c4daa5a823921748df7cf98` closes the old comparison
on a failed settings decision and refreshes connection status. Otherwise a newer
backend comparison could sit behind the still-displayed old choice, or denied
access could remain visibly online. The two real-handler regressions cover a
changed review and HTTP 403. Desktop suite: 32 passed. TypeScript/Vite/native
checks passed. The first Desktop-a rebuild from `600f206` is retained; the later
Desktop-b build includes this UI correction. Final artifact selection and GUI
acceptance are recorded below when verified.

## Launch-policy investigation

[The investigation](windows-launch-policy-investigation-2026-10-15.md) corrects
prior notes: the raw error establishes a pre-execution command rejection but does
not identify automatic review, a Windows policy or a user-configured rule. Current
config is approvals never, reviewer user and full filesystem access. No security
setting was changed and no alternate Windows launcher was tried. The exact
rejection reason and latest Windows GUI acceptance remain open.

## Windows preparation

The updated static Windows fixture is prepared from Desktop
`internal-20261015-b`, source `5312a34`. Manifest/file checks and PowerShell syntax
pass. The manual starter at
`C:/Projects/127Vaults-sync-desktop-20261013-a/start-isolated-desktop.ps1` now pins
extracted `app-m`, copied `profile-l`, separate `webview-m` and inspector 12915.
`manual-preparation-20261015-b.json` records installer/executable hashes. The prior
starter is preserved as `start-isolated-desktop.previous-20261015-b.ps1`, with all
older apps and profiles retained. No Windows GUI launch, installation, native
registration or security-settings change occurred.

## Completed package selection and actual GUI acceptance

Selected CLI is now `internal-20261015-a` on both OSs, source `600f206`; Desktop
is `internal-20261015-b` on both OSs, source `5312a34`. All six selected release
file sets and SHA256 sums passed verification, including unchanged server-e and
extension-a. Both Desktop build gates passed 32 tests, 78 CLI library tests with
one separate live fixture ignored, TypeScript/Vite/native checks, optimized
binaries, Windows NSIS, Linux DEB/AppImage and framed native-host discovery.
The two source revisions have no differences under `apps/cli` or `crates`.

Actual Linux packaged Desktop-b DOM/React/native acceptance passed two new cases:

- A mid-dialog settings GET/403 makes Keep server fail, closes the old comparison,
  reports failure, updates Profile to Offline with the authorization reason, keeps
  the settings file byte for byte, and locks cleanly. That GUI profile had no local
  pending settings draft; encrypted pending preservation is proven by the native
  cases, not inferred from this GUI case.
- While the actual GUI held its comparison open, the packaged Windows CLI peer
  renamed the controlled fixture vault on the real server. Keep server refused
  the stale choice and closed it. Reopening review displayed the newer peer vault
  name; a new explicit Keep server adopted it and refreshed navigation. The GUI
  locked, and the peer restored the original vault name. No direct native-command
  mocks or synthetic UI handler substitutions were used for these GUI runs.

`C:/Projects/127Vaults-settings-review-20261015-a/evidence.json` is the combined
verified index. GUI records are `gui.json`, `gui-preservation.json`,
`gui-changed.json`, `gui-changed-adoption.json` and the guarded peer advance/restore
records. Runners `gui-run.mjs` and `gui-changed-run.mjs`, their shell scripts and
`verify-all.mjs` are retained. The exact original server environment and mapping
are restored by each runner; original profiles and prior evidence remain intact.

Next work continues the untouched pairing/lifecycle/deletion/collision and
intended-host/physical gates in the original matrix. Windows GUI remains open,
along with actual web-source extension permission/selection/reconnect and the
other explicitly recorded manual/operational checks. This completed settings
subset is not full release acceptance. No remote push or public deployment.

## Global replacement verification before item-queue discard

Source `4e1e1461666a1b6c50e43eda58719996ae05aba5` fixes a latent data-loss path in
the registered Desktop `discard_local_changes` backend command. The current React
source has no caller for that command; this is not claimed as a reproduced GUI
button failure or a CLI command. The CLI library provides the shared engine, but
CLI agent dispatch does not expose this global operation. Selected CLI-a remains
applicable; only Desktop requires an updated package for this registered entry.

Before the fix, a real encrypted offline edit was queued, the replacement GET
returned 401, and the operation returned an error after clearing `pending`. The
new regression failed with the previously nonempty queue becoming empty. The
backend now verifies replacements for every local vault before retiring any
queued request. A missing local vault in the server list also refuses discard.
401/403 refresh refusals mark the session offline with the preservation reason;
503 preserves an otherwise-online session.

Seven real HTTP/encrypted-engine cases pass: 401, 403, 503, missing vault,
malformed unauthenticated catalogue, successful verified server replacement, and
a later-vault failure after the first vault was verified. The last case retains
the first vault's exact pending request while allowing its authenticated remote
view to refresh. All requests are GETs; no pending edit is uploaded. Test-only
follow-up `b84cef7` adds the multi-vault case. Final source library suite: **81
passed, 0 failed, 1 separately gated live fixture ignored**. Strict workspace
Clippy and formatting pass. This is encrypted source transport evidence, not
actual TLS/PostgreSQL or a normal GUI workflow claim.

A new Desktop-c candidate is built from committed `4e1e146`, whose build snapshot
contains the preceding 80 passing library tests; its product code matches the
follow-up test-only commit. Package completion/selection is recorded below after
verification. Earlier Desktop-b settings GUI cases remain historical evidence,
not retests of Desktop-c.

## Lifecycle fixture inventory and next isolation requirement

Read-only packaged CLI inventory at
`C:/Projects/127Vaults-vault-move-20261015-a/inventory.json` confirms the retained
fixture already has five active vaults (item counts 31, 50, 0, 5 and 14). Only one
is empty. A sixth-vault capacity refusal was already verified earlier. Do not
retire an existing fixture vault merely to manufacture a move test, or delete
items to make room. A dedicated fresh fixture/account/project is the next useful
step for a complete move/interruption/ownership matrix with independently owned
source and destination vaults. The inventory used a copied profile, read actual
packaged item lists and made no server mutation.

### Verified Desktop-c selection and selected-server GUI smoke

Desktop `internal-20261015-c/windows` and `/linux`, source `4e1e146`, now supersede
Desktop-b in the selected inventory. CLI-a, server/web/admin-e and extension-a
remain selected. All six complete selected file sets and SHA256 sums pass. Both
Desktop-c builds pass locked dependencies, TypeScript/Vite/native checks, 32
Desktop tests, 80 library passes plus one separate live fixture ignored, optimized
CLI/native-host/App, NSIS or DEB/AppImage and framed native-host discovery. The
later `b84cef7` is test-only; product code is unchanged.

Actual Linux Desktop-c GUI online unlock, retained-item read and lock pass against
the selected server-e image (`8caae90f...`, source `ee83e2d`). The test temporarily
used the existing copied server-e operator fixture with its listener mapped to
12892; image identity was checked before GUI work. The retained item was read,
not edited. This smoke covers the refactored verified hydration path; it does not
claim to invoke the global-discard command through the UI.

Evidence index:
`C:/Projects/127Vaults-global-reload-20261015-a/evidence.json`; `gui.json`,
`runtime-image.json`, `run.mjs`, `gui.sh`, `verify.mjs` and both environment snapshots
are retained. Both exact operator environments and original bundle-d runtime were
restored and checked; the owned server/database are healthy. Only the dedicated
fixture D-Bus session was stopped. Original profiles and data remain intact.

Windows static preparation now pins Desktop-c in `app-n`, copied `profile-m`,
separate `webview-n`, inspector 12915 at the existing manual starter path. Manifest,
file hashes and launcher syntax pass. Previous starter is separately preserved as
`start-isolated-desktop.previous-20261015-c.ps1`; preparation receipt is
`manual-preparation-20261015-c.json`. No Windows GUI execution, installation,
native registration, security setting change, public deployment or remote push.

The next substantive automation work is a fresh isolated lifecycle fixture for
move, interruption and ownership cases. The capacity inventory above prevents
using an existing retained vault as a disposable source. Physical and remaining
pairing gates stay open; do not mark internal release complete.

## New isolated packaged move and interruption evidence

[Isolated lifecycle acceptance](isolated-lifecycle-2026-10-15.md) now passes selected
server-e with packaged Windows CLI-a normal move, lost accepted copy reply and
lost accepted finalization reply. Exact journals/reserved IDs survive restart;
request IDs and SHA256 bodies match replay, copy operation ID matches, receipts
clear journals only after verification, and no duplicate copies appear. Typed
login/card fields and masked/explicit secrets, collection de-duplication, default
view retargeting and retired-source read/write behavior pass on a distinct Windows
device. A newly enrolled Linux device independently reads all four final copies
using selected packaged Linux CLI-a, including exact IDs and secrets.

The test uses a new private CA/identity, PostgreSQL project and loopback12898,
not the retained five-vault 12892 installation. Only the new project is stopped;
its data and failed fixture attempts are retained, exact environment restored,
and the original installation stays healthy. Fixture setup assertion mistakes
were corrected with guarded resume, never data deletion. No product runtime code
changed. The enrollment-only helper passes strict Rust example Clippy/format and
a relative-root rejection check; JavaScript helpers pass syntax and actual runs.

Combined retained index:
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/combined-evidence.json`.
Detailed boundaries and concrete next interruption/ownership/UI cases are in the
new lifecycle document. Selected artifact versions stay unchanged; internal
release remains unaccepted and the goal active. Commit locally, do not push.

## Move divergence, early abort and actual revocation subsets

[Isolated lifecycle evidence](isolated-lifecycle-2026-10-15.md) now also proves:
changed-source and changed-destination refusal after a lost accepted copy reply;
exact retained journal/copy recovery; explicit abort that preserves both peer
edits; abort before receipt replay preserving the pending encrypted request; and
ordinary sync replaying only that copy without retiring the source. Independent
selected Windows/Linux CLI readers verify the resulting data and secrets.

A separately enrolled disposable device D then lost an accepted copy reply and
was actually revoked by trusted device B. Restart reports offline/unauthenticated
with encrypted local unlock retained. Its journal bytes, exact pending request
and masked review survive; move/sync refuse and send no copy retry. Trusted
Windows/Linux peers still verify D's historical signature and read the accepted
copy. D is deliberately left revoked with its queued draft/journal retained;
owner A, peer B/C and the retained 12892 installation are untouched. The reason
is currently generic HTTP401; device-specific recovery wording remains a UX
follow-up. This is actual TLS/PostgreSQL revocation, not response injection.

`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/guard-combined-evidence.json`
and `verify-guards.mjs` verify all cases, matching replay IDs/hashes, the revoked
profile's retained data, selected package hashes and exact environment restoration.
Only the isolated project is stopped; original server/database stay healthy.
Product runtime/artifacts did not change. UI/reverse-writer, ownership,
finalization-abort and broader physical/operational gates remain open. Internal
release is still unaccepted; the goal remains active. No push.

## Linux writer finalization and Desktop secret-read acceptance

Selected Linux CLI-a now passes an actual move whose accepted finalization reply
is lost. A fresh process refuses abort at finalizing stage without changing the
journal; exact request-ID/body-hash replay verifies the receipt and clears it.
A distinct selected Windows CLI-a reader verifies the reserved copy and ordinary /
secret fields. Actual selected Linux Desktop-c then reads the retained peer edit,
checks ordinary/custom fields, masks both secrets, explicitly reveals/remasks each
through real GUI buttons/native backend, and locks against selected server-e.
This is a GUI reader test, not a move-UI claim.

[Lifecycle evidence](isolated-lifecycle-2026-10-15.md) records exact phases and
limits. Combined retained index:
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/linux-final-combined-evidence.json`.
Selected CLI/Desktop manifests and hashes pass; D's original revoked pending
request and complete journal remain unchanged. The isolated environment is
restored and project stopped; original 12892 stays healthy. No runtime code or
artifact changed, no push. Move-UI/additional pairing/ownership and physical /
intended-host gates remain open. The full internal release is still unaccepted.

## Selected-server ownership/session/account-isolation acceptance

[Ownership evidence](ownership-acceptance-2026-10-15.md) now passes real invitation,
TLS email capture, OPAQUE activation/login, request/cancel/accept and receipt replay,
session invalidation, last-owner guards, operator restrictions and private-vault
isolation. The selected Windows CLI reads the former owner's secrets while it is
demoted. Original ownership is restored and the new member remains a user with an
empty private directory. No product runtime or selected artifact changed.

The initial email 503 was the local capture's network wiring, resolved inside the
owned server container without disabling TLS validation. The combined verifier
passes exact fixture restoration, package hashes, unchanged revoked D draft/journal
and original 12892 health. Isolated 12898 is stopped. Actual ownership browser UI,
stale-auth boundary, external SMTP and broader physical/pairing/operational gates
remain open. Internal release is still unaccepted; no push.

## Selected admin browser and real stale-auth boundary

[Ownership acceptance](ownership-acceptance-2026-10-15.md) now also passes actual
selected admin-browser request/cancel, friendly last-owner denial and same-ID
retry, password clearing, audit/narrow layout and separate admin-operator UI
restrictions. A real member session aged 310 seconds without clock/database
changes still lists requests but cannot accept ownership (fresh_auth_required).
A fresh production login accepts the identical request ID; member is demoted back
to user, original owner unchanged, private empty directory preserved.

New/updated helper syntax checks and combined retained evidence/cleanup verification
pass. Isolated project stopped, exact wiring restored, original server/database
healthy, revoked D draft/journal unchanged. No product artifact changed. Customer
ownership acceptance UI, physical/intended-host and other matrix gates remain
open. Full internal release remains unaccepted; no push.

## Actual customer ownership web UI

Selected web-e passes genuine browser-key enrollment, actual Settings/Devices
ownership request display, confirmation cancellation with no acceptance, one
successful confirmed acceptance, app lock/success toast, fresh unlock, absent
accepted request and preserved empty private directory. Final Lock works. The
operator restores member=user and verifies original=owner through the live account
directory. Strict-CA transport remains enabled; service workers are bypassed for
this ordinary-web UI check, separate from physical PWA install/update acceptance.

[Ownership evidence](ownership-acceptance-2026-10-15.md) records the retained profile,
diagnostics, exact driver corrections and limits. No product runtime changed.
Customer stale-auth toast and broader physical/pairing/intended-host gates remain
open. Full internal release remains unaccepted; no push.

## Actual stale-auth customer UI completed

[Ownership evidence](ownership-acceptance-2026-10-15.md) now also proves actual
310-second browser-session rejection, exact lock/unlock guidance, preserved pending
request and visible lock/fresh-unlock recovery through successful acceptance.
Inactivity was prevented with harmless device refreshes, without reauthentication
or clock/database changes. Acceptance lock/toast, new unlock, absent grant, empty
private directory and final Lock pass. The member is restored to user.

The interrupted parent left the isolated project up after recording the passing
case and role cleanup. No runner/browser process remained on continuation. Live
API checks verified member=user, original=owner and original five vault entries /
nine destination items before completing stop. Combined verifier and syntax checks
pass; bundle/wiring restored, original server healthy, revoked D draft intact.
No product runtime or artifact changed. Broader release gates remain open and
internal release remains unaccepted. No push.

## Actual selected web normal move and independent reader

[Lifecycle evidence](isolated-lifecycle-2026-10-15.md) now proves actual web controls
create a controlled source/destination and login, cancel confirmation without a
removal, then move exactly one copy and retire the source. Actual UI preserves
ordinary fields, masks/reveals the password, offers no restore for the moved source
and locks. A distinct registered device independently authenticates and decrypts
both retained original and new copy with exact contents/counts. This peer is a
production-crypto Node reader, not packaged CLI/Desktop evidence.

Syntax and combined verification pass; isolated project stopped, original server
healthy, exact wiring restored and revoked D draft intact. No runtime/artifact
change. The member now has two vault entries, one retired: do not rerun earlier
empty-directory ownership phases or reprovision the completed move. Web fault/
restart, custom/typed/settings and other pairings remain open along with broader
physical/operational gates. Internal release remains unaccepted; no push.

## Actual web accepted-copy loss and full browser recovery

[Lifecycle evidence](isolated-lifecycle-2026-10-15.md) now verifies a real accepted
copy HTTP200 whose reply is lost, UI Resume guidance, full browser-process restart,
exact retained journal, identical request-ID/body-hash receipt replay, final source
retirement and cleared pending action. UI reads/masks/reveals the unique copy and
locks. A different registered device independently decrypts original and copy,
checks exact counts and preservation of the earlier normal-move item ID.

Combined syntax/evidence/cleanup verification passes. The member now has three
retained vault entries (two retired, one active, destination two items); historical
fixed-count phases must not be rerun blindly. Isolated project stopped, original
server healthy, exact bundle/wiring restored and revoked D draft intact. No product
runtime/artifact changed. Web finalization/guard/typed/settings cases and other
writer/package/physical/operational gates remain open; release unaccepted. No push.

## Actual web finalization reply loss and receipt-only recovery

[Lifecycle evidence](isolated-lifecycle-2026-10-15.md) now also proves actual web
finalization HTTP200 reply loss, server-retired source with durable final request,
full browser restart, exact journal and same request-ID/body-hash receipt replay.
Resume sends zero copy POSTs, clears pending state and reads the unique reserved
copy with masking/reveal/lock. A distinct registered device decrypts original and
copy, verifies source/destination counts and retains both prior copy IDs.

Member now has four retained entries (three retired; destination three items).
Syntax and combined evidence/cleanup checks pass: project stopped, original server
healthy, exact bundle/wiring restored, selected CLI hashes and revoked D pending
draft intact. No product runtime or artifact change. Divergence/abort, typed/
settings, packaged peer/other writer, physical/operational gates remain open.
Internal release is unaccepted; no push.

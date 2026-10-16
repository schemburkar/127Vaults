# Internal release: functionality first

The user changed the acceptance bar on October 16: prioritize implemented
functionality and applicable P1 defects, with basic sanity checks rather than the
exhaustive cross-client test matrix. Intended-host/physical acceptance remains a
separate user follow-up. The older matrix is retained as a coverage backlog; an
untested permutation is not automatically missing product functionality.

## Implementation assessment

No currently reproduced, unfixed P1 product defect was identified in this review.
Previously reproduced sync/data-loss defects were fixed. The latest product fix,
`a574a62`, refreshes Desktop/web license notices during an unlocked session and
prevents late responses updating a replaced session. It is built into Desktop-e
and server/web-b; CLI-b and extension-a remain compatible retained packages.

One concrete capability is absent: **individual item deletion**. Vault
archive/restore/move exists, but the private item API refuses DELETE and CLI/UI
does not expose an item-delete action. The documented minimum internal flow did
not require that action. The user has been asked whether it belongs in this cut;
do not silently implement a destructive protocol change or silently call it done.

| Surface | Existing implemented core | Basic evidence / limitation |
| --- | --- | --- |
| Server | Trust, onboarding/auth, encrypted storage/sync, authorization, licensing, backup/restore | Server-b upgraded the retained installation; authenticated reads and current backup restore rehearsal pass |
| Web/PWA | Unlock, item creation/editing, typed fields, offline replica/replay, conflicts and vault lifecycle | 74 product tests and build pass; rebuilt client is served by server-b; actual installed-site follow-up remains separate |
| Desktop | Native unlock/enrollment, encrypted replica, item editing/sync, conflicts, vault lifecycle, native handoff | 33 product tests and Windows/Linux Desktop-e builds pass; latest physical Windows GUI is not claimed exercised |
| CLI | Genuine device enrollment, OS-keyring unlock, item create/edit/read, sync/review/merge and vault operations | Actual packaged Windows CLI-b unlock/sync, redacted/explicit secret reads and empty queue pass on server-b; prior Linux packaged checks remain scoped |
| Extension | Source selection, guarded filling, native/web handoff and lock boundaries | Current syntax/manifest sanity passes; prior native handoff evidence retained; positive web host grant/passkey ceremonies remain permission-dependent |
| Admin | Operator authentication, directory/invitations, ownership and audit controls | Actual server-b admin page, sign-in, account listing and sign-out pass; earlier management-write evidence retained |
| Public site | Static internal preview pages with intake/download distribution closed | Release catalogue validates; prior eleven-page desktop/mobile checks retained; no public deployment performed |

## This basic sanity run

Reused `tests/internal/licensing/license-native-run.mjs --sanity-server-b`:
selected-image startup under the pinned CA, an independent owner decrypting the
retained item, actual packaged CLI-b online unlock/sync/secret reads, served web
entry and rebuilt license-refresh script, and admin login/list/logout all pass.
The independent encrypted-item digest still matches the pre-upgrade state.

Private record:
`C:/Projects/127Vaults-license-isolated-20261015-a/functional-sanity-2026-10-16.json`.
No test item was created, edited or removed in this run. The owned installation
was stopped afterwards. The original 12892 containers are currently stopped;
this run did not start or change that original installation. No containers remain
running after the sanity run.

Also passed: extension syntax/manifest checks, public release catalogue
validation, and internal suite structure checks. The structure check found and
fixed one stale side-effect import in the Linux GUI suite wrapper after the
directory reorganization; it now validates that import form too. This is test
wiring repair, not a product-feature fix.

## Next decision

If individual item deletion is required, implement its authenticated encrypted
transaction and client actions with a focused sanity/regression check. If deferred,
record that scope choice and finish the functionality-oriented package handoff.
Keep Windows GUI launch, extension permission/passkey ceremonies and physical
acceptance visibly separate; no permission was granted or policy bypassed here.
Do not start further exhaustive collision/history/license permutations merely
because the older coverage ledger marks them partial.

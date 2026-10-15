# Internal release requirement reconciliation — October 15

Internal release remains **not accepted**. This review reconciles the original
expanded requirements with current evidence instead of treating repeated green
subset checks as completion. It introduces no exception or new acceptance policy.
The machine-readable [remaining-gate register](internal-release-remaining-gates-2026-10-15.json)
preserves all twelve original scenario families and ten separately named gates.
They are families/gates, not a count of independent per-client test cases.

The authoritative original matrix requires every enabled writer/reader pair in
both directions. Recent member CLI/GUI cases are strong evidence for their exact
pairs; they cannot establish other pairs or all enabled types. Extension consumes
credentials through each supported source; admin manages authorization without
decrypting vault items. Physical installation/interaction and intended-host gates
remain distinct from automated source/engine/DOM/container checks.

| Original family | Current evidence and concrete remaining work |
| --- | --- |
| SYNC-01 fields/types | Current ordinary-login member round trips; earlier seven-type subsets. Other selected-package creator/reader/type pairs and latest Windows GUI remain. |
| SYNC-02 offline/restart | Current native both directions and Linux GUI queued edits; prior chained creation/PWA subsets. Other chained-create/UI/installed pairings remain. |
| SYNC-03 lost reply/retry | Current targeted web move protection plus earlier native/PWA/GUI receipt replay. Remaining selected-package ordinary/multi-queue/UI loss pairs remain. |
| SYNC-04 checkpoints/history | Earlier actual long-history and checkpoint catch-up subsets. Other packaged UI/pair and retained-anchor/fork cases remain. |
| SYNC-05 nonoverlap | Earlier actual native/GUI subset. Other selected client/UI directions remain. |
| SYNC-06 conflict/owner/merge | Current both native member directions and Linux GUI comparison/cancel/merge. Multiple pending/vaults, latest Windows GUI and other UI/pairs remain. |
| SYNC-07 server copy/missing item | Earlier explicit server/local and queue isolation subsets. Actual absent-item classification, selected discard/server choice and untouched sibling requests need broader runtime/UI proof. |
| SYNC-08 stale create/collision | Earlier fixed/recovered original queues and chained identity evidence. Create-ID collision, broader pending chains and loss/field combinations remain. |
| SYNC-09 settings/default view | Actual denied/new-revision native decisions and earlier GUI navigation refresh. Broader default-view/collection/removal preference/interruption pairs remain; empty item queues do not prove settings convergence. |
| SYNC-10 lifecycle/ownership | Current destination P1/valid move plus earlier native/GUI/ownership subsets. Remaining UI/writer/type/settings-retarget combinations remain. |
| SYNC-11 device/lock/source | Revoked-D preserved and earlier source handoff; actual selected web missing-permission refusal. Affirmative web-source, Windows active session, physical idle/lock and wider rotation/expiry remain. |
| SYNC-12 upgrade/packages | Current manifests and fresh server restore proof, earlier installer lifecycle. Existing-profile upgrade combinations, latest Windows GUI, clean physical and intended-host acceptance remain. |

Additional explicit gates found in the earlier requirements must not disappear
behind the latest short status table:

- Packaged/UI 1,000-envelope session-budget message and fresh-unlock/retry recovery.
  Core regression and historical across-session long-history success are partial.
- Signed fictitious license read-only/locked/revoked notices and higher-sequence
  renewal with exact pending edit retention. Authentication denial is a different
  scenario and does not establish license enforcement/renewal acceptance.
- Applicable clipboard/drag disclosure, accessibility and physical interaction.
- Latest Windows supported GUI launch and the still-unidentified earlier rejection.
- Pending isolated-browser affirmative web-source access and enabled passkey
  permission/ceremony. No user answer or waiver was inferred.
- Intended-host trust/onboarding/admin/SMTP; physical clean-host/keyring/terminal/
  installation/idle/lock; actual installed-PWA/update/retained-edit acceptance.
- Public site retains its passed local 11-page private-cut checks. Public
  deployment/signing/distribution/real secrets were already outside that cut;
  this review neither performs nor newly exempts them.

## Verification performed

`node tests/internal/audit/release-gap-audit.mjs` passed. It verifies all six selected
artifact file sets/SHA256/revisions, source-reference existence and the original
family inventory, runs the latest actual-scenario evidence/cleanup verifier, and
checks selected operational records (seven real checks, paired decrypted source/
restore digest, distinct retained stopped volumes). It starts no server and repeats
no mutation or restore. Existing original server remains healthy and revoked-D
pending request/journal remains exact. Its scoped evidence is still scoped.

Report: current candidate lab `release-gap-audit.json` records the Git HEAD and
register hash, selected provenance, assessments and checks. This is a successful
requirement/evidence reconciliation, **not a successful full release audit**.
No new product P1 was reproduced in this review. No runtime artifact, browser
permission, Windows policy, native registration or remote state was changed.

## Next local work

Prioritize multiple-pending independent decisions and absent-item classification,
then controlled create-ID collision/chained pending, packaged/UI budget recovery,
and remaining settings/default-view/license cases. Use fresh controlled fixture
items/accounts where destructive cases require them; never delete retained proof
items, reset profiles or discard pending ciphertext to simplify acceptance.
Retain the existing member Desktop profile and avoid concurrent use with its
original Linux CLI identity; sync that CLI Online before future offline use.
Human/access-dependent rows remain pending independently; they do not prevent
these local tasks. Complete the full pair/requirement audit before accepting the
goal, with every exception explicitly reviewed rather than implied by this file.

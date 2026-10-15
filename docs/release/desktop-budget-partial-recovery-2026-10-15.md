# Interrupted Desktop queue recovery

The interrupted 298-edit offline rehearsal is recovered. Internal release remains
unaccepted, and LOCAL-01 budget-limit acceptance is still open.

Selected Desktop-c and server-a were used with the retained member profile and
original device key. The first online launch replayed 291 requests before the
fixture inspector timed out. The remaining seven were verified against the exact
suffix of the private original replica snapshot, then replayed through the real
GUI. No queue clearing, profile reset, fabricated operation, or budget override.

The separate Windows CLI verified the resulting title (`budget offline 298`)
and original synthetic password, then restored the original item through a normal
edit. It verified zero pending/conflicts, the six-item destination catalogue,
historical peer item, source retirement, and refusal to edit the retired source.
A fresh actual GUI process verified the restored title, unchanged visible fields,
password masking, and lock. Final independent native cursor: 327.

Private authoritative record:
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a/member-desktop-budget-partial.json`.
Status is `recovered-partial-run`; budget acceptance is explicitly `not-proven`.
The three completed phases were recorded at 15:57:08–15:57:16 UTC on October 15.
The original encrypted snapshot is preserved outside Git.

The recovery driver is separate from the full budget test. Its inspector allows
up to 60 seconds per command while existing callers retain the ten-second default.
This addresses observation during recovery; it does not establish the cause of
the original slow saves or prove a product performance fix. Recovery helpers are
one-use evidence workflows, not instructions to rerun completed mutations.

Validation: helper syntax checks and `git diff --check` passed. The full existing
`node tests/internal/audit/release-gap-audit.mjs` passed its scoped checks, reconciling
12 original scenario families, 10 additional gates, and six selected artifacts;
it explicitly reports internal release unaccepted. App/helper cleanup and empty
GUI queue checks are included in that audit. Selected server is stopped with its
volume retained; original server stays healthy.

Next: investigate growing offline save latency and inspector timeouts before
another bounded session-budget test; finish the remaining requirements in the
authoritative remaining-gates and reconciliation documents. Earlier Windows GUI
policy investigation remains pending. No new runtime build was required for these
fixture-only changes. No remote push.

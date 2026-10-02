# Documentation consolidation plan

## Goal

Make each fact easy to find and update once. Preserve security decisions and
verification evidence; remove repeated narrative, stale handoffs, and duplicate
task lists.

## Canonical owners

| Topic | Canonical file | Other files should contain |
|---|---|---|
| Product status and entry points | `README.md` | A short link only |
| Accepted architecture decisions | `docs/adr/*.md` | Links and brief implications |
| ADR inventory and status | `docs/adr/README.md` | Every ADR, including 0018–0020 |
| Unresolved product questions | `docs/product/questions.md` | Open questions only; decided answers move to ADRs |
| Product outcomes and completion state | `docs/product/implementation-backlog.md` | One checkbox per outcome; no prompts or evidence narrative |
| Execution order, model, prompt, dependencies | `docs/product/implementation-batches.md` | One batch definition and current status |
| Current handoff | `docs/product/next-session.md` | Links plus the next batch only; rewrite each handoff |
| Implementation and release gates | `docs/release/beta-readiness.md` | Gate checklist and current gate state |
| Public release procedure | `docs/release/first-public-beta.md` | Ordered release runbook only |
| How to run development | `docs/release/experimental-development.md` | Current commands, prerequisites, and cautions |
| Historical verification evidence | Focused `docs/release/*-verification.md` reports | Dated scope, result, evidence, limits; no backlog copies |
| Protocol and crypto specifications | `docs/sync/` and `docs/security/` | Normative technical detail; ADRs explain why |

## Audit findings

1. **Task state is stale in three places.** `implementation-batches.md` says
   Batch 3B is next even though 3B and 3C0 are marked accepted later in the same
   file. `next-session.md` also calls 3B next. `implementation-backlog.md` says
   the Batch 3 feasibility review is next. The batch file should be authoritative;
   the next-session file should link to its current handoff.
2. **The backlog duplicates itself.** “First-slice increments,” “Deferred
   automated tests,” “Larger items queued,” and the domain sections repeat many
   outcomes at different granularity. Retain domain outcomes once, then reference
   their IDs from batches. Keep deferred tests as acceptance criteria attached to
   the relevant outcome instead of a second backlog.
3. **Batch prompts are useful but verbose.** Each batch repeats global rules.
   Keep global constraints once, then reduce each batch to: status, model,
   dependencies, owned paths, task prompt, acceptance, and exclusions.
4. **`questions.md` is mostly a decision ledger, not a questionnaire.** It
   repeats ADR content, retains stale “partly decided/open” language, and has
   numbering out of order (`29–31` follow `59`). Move accepted decisions to their
   ADR owners and leave only unresolved questions with stable IDs.
5. **The ADR index is incomplete.** `docs/adr/README.md` stops at ADR-0017;
   ADR-0018 through ADR-0020 exist. Add status columns so proposed and accepted
   decisions are distinguishable.
6. **Run instructions and evidence are mixed.** `experimental-development.md`
   combines current commands with a long dated verification record. Keep the
   runbook operational; link to dated evidence reports.
7. **Helper evidence is duplicated.** `dev-helper-verification.md` and
   `dev-helper-clean-machine.md` repeat fixtures, limits, and follow-up work.
   Keep one concise current verification matrix; archive or supersede the other
   without deleting unique evidence.
8. **Review reports contain shadow backlogs.** `compose-static-review.md` and
   helper reports list implementation tasks already represented in the central
   backlog/batches. Replace those lists with backlog IDs after the IDs exist.
9. **README status will decay.** It enumerates partial implementation details
   also tracked by the backlog and readiness document. Keep only phase, warning,
   next entry point, and current run command.
10. **Production and development scope needs sharper labels.** The product
    decision is containers-only for v1 deployment, while the development runbook
    documents a native server command. Keep the command only as an explicitly
    unsupported development/debug path.

## Bounded cleanup sequence

1. Fix factual drift only: update the batch handoff, replace `next-session.md`
   with the current next task, and complete the ADR index.
2. Assign stable IDs to backlog outcomes (for example `DEP-001`, `CRY-001`) and
   update batches/reports to reference them.
3. Collapse duplicate first-slice, larger-item, and deferred-test entries into
   the domain backlog while preserving completion state and acceptance needs.
4. Normalize every batch to the compact template above; remove repeated global
   instructions.
5. Convert `questions.md` into an open-decisions list. Verify every removed
   decided answer has an ADR or other canonical owner first.
6. Split current operating instructions from historical evidence in release
   docs; consolidate the two helper reports into one verification matrix.
7. Replace shadow task lists in review reports with backlog IDs and retain their
   findings as immutable dated evidence.
8. Shorten README last, after its targets are stable. Run link checking,
   decision cross-checks, and `git diff --check` after each step.

Do one step per reviewable change. Never delete unique threat analysis, test
observations, source citations, rejected alternatives, or release/legal evidence.

## Writing style

- **Clear:** lead with the decision, result, or action; define ambiguous terms.
- **Concise:** state a fact once and link to its canonical owner.
- **Practical:** include exact commands, prerequisites, acceptance, and failure
  behavior only where the reader acts on them.
- **Accurate:** separate implemented, verified, planned, deferred, and unknown.
- Prefer short sentences and bullets. Avoid conversational history and repeated
  cautions; keep one prominent warning at the relevant boundary.
- Evidence reports use: date, scope, result, evidence, limitations.
- ADRs use: status, context, decision, consequences, alternatives.
- Backlog entries describe outcomes; batch prompts describe work; runbooks
  describe operations. Do not mix these roles.

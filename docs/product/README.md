# Product work index

Updated 2026-10-02. The four component backlogs below are the only live task lists. Each row has a stable ID, a state, and an acceptance condition. Change a row to **Done** only after its acceptance is recorded in the same backlog. A component's `in-progress.md` contains only the current wave, its owner, next action, and verification. Delete that file when the wave is complete; start a new one only when work starts. Evidence reports, ADRs, protocols, and runbooks remain reference material, not competing task lists.

Audit verification on 2026-10-02: server tests 55 passed/1 skipped; web 14 passed; desktop 8 passed; CLI 22 passed. These are local tests, not a clean-host deployment, human browser ceremony, backup/restore rehearsal, or security review.

| Component | Backlog | Active wave |
| --- | --- | --- |
| Web | [web backlog](web-backlog.md) | [web in progress](web-in-progress.md) |
| CLI | [CLI backlog](cli-backlog.md) | [CLI in progress](cli-in-progress.md) |
| Desktop | [desktop backlog](desktop-backlog.md) | [desktop in progress](desktop-in-progress.md) |
| Server | [server backlog](server-backlog.md) | [server in progress](server-in-progress.md) |

The [release gate](../release/beta-readiness.md) defines whether the whole product may ship. The [API contract](../architecture/api-v1-contract.md) and [ADRs](../adr/README.md) define behavior. Older batch plans and work logs are historical context; do not update their checkboxes.

# Product work index

Updated 2026-10-06. The six component backlogs below are the only live task lists. Each row has a stable ID, a state, a priority, and an acceptance condition. Change a row to **Done** only after its acceptance is recorded in the same backlog. A component's `in-progress.md` contains only the current wave, its owner, next action, and verification. Delete that file when the wave is complete; start a new one only when work starts. Evidence reports, ADRs, protocols, and runbooks remain reference material, not competing task lists. The [priority review](backlog-priorities.md) sets the current MVP cut and execution order.

Audit verification on 2026-10-02: server tests 56 passed/1 skipped; web 14 passed; desktop 8 passed; CLI 22 passed. These are local tests; separate restore and deployment evidence is linked from the server backlog. Human browser acceptance and security review remain open.

| Component | Backlog | Active wave |
| --- | --- | --- |
| Public site | [public site backlog](public-site-backlog.md) | Waitlist and release-catalogue foundation |
| Web | [web backlog](web-backlog.md) | [web in progress](web-in-progress.md) |
| Browser extension | [extension backlog](extension-backlog.md) | [extension in progress](extension-in-progress.md) |
| CLI | [CLI backlog](cli-backlog.md) | [CLI in progress](cli-in-progress.md) |
| Desktop | [desktop backlog](desktop-backlog.md) | [desktop in progress](desktop-in-progress.md) |
| Server | [server backlog](server-backlog.md) | [server in progress](server-in-progress.md) |

The [release gate](../release/beta-readiness.md) defines whether the whole product may ship. The [API contract](../architecture/api-v1-contract.md) and [ADRs](../adr/README.md) define behavior. Older batch plans and work logs are historical context; do not update their checkboxes.

The public website walkthroughs map to DESK-008, EXT-003/009, and CLI-011. The CLI walkthrough reflects today's JSON output; the optional table view is a backlog item, not a shipped feature.

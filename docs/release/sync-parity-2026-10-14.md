# Sync parity and release progress

Internal release is **not accepted**. This table distinguishes user-facing
capabilities from the exact evidence that still needs completing. Server stores
and verifies encrypted operations; extension delegates sync to its selected
unlocked source; admin manages authorization without decrypting vault items.

| Flow | Web/PWA | Desktop | CLI | Remaining gate |
| --- | --- | --- | --- | --- |
| Durable create/edit and reconnect | Implemented; real-server offline subset passes | Linux package restart/replay passes | Windows/Linux packaged queue subsets pass | Latest Windows GUI; all-pair/type combinations |
| Retry/lost reply | Real-server accepted-write/lost-reply/peer-edit passes | Shared native engine | Shared native engine | Native lost-reply injection and peer verification |
| Non-overlapping changes | Implemented | Shared native engine | Packaged Windows/Linux automatic merge passes | GUI combinations |
| Review pending item/changed fields | Implemented | Implemented | Conflict list/show implemented | CLI general pending-review parity and broader multi-queue UI |
| Verified read-only comparison | Packaged real-server pass | Engine/read-only UI regressions; latest Windows GUI pending | New compare command; rebuilt Windows real-server pass | New immutable CLI package acceptance |
| Keep server/local | Packaged server-copy pass | Engine/UI subsets | Both packaged Windows/Linux choices pass | Latest Windows GUI and multi-queue isolation |
| Selected-field merge | Packaged real-server pass | Implemented, engine subset pass | New merge command; rebuilt Windows to packaged Linux real-server pass | New CLI packages; GUI combinations; CLI selects custom-fields array as a group |
| Missing item / stale creation | Classification and replay implemented | Shared native engine and retained queues | Shared native engine | Deleted-item and collision matrix across UIs |
| Vault archive/restore | Isolated browser subset | Shared native engine/UI subsets | Packaged Windows/Linux propagation and read-only refusal pass | Real packaged web/Desktop lifecycle matrix |
| Source handoff/lock/reconnect | Web source bridge implemented | Actual Linux GUI-owned extension matrix passes | Linux agent-source matrix passes | Windows active-session and actual web-source extension |

CLI now supports `conflict compare` and `conflict merge` with an explicit base and
field-source choices. Comparison redacts built-in/custom/related passwords and
preserves the exact pending request; merge uses verified versions internally.
Invalid/duplicate choices and absent-server-item merges are refused. Connector
read-only agents cannot invoke either action. New functionality's initial evidence
uses the rebuilt Windows debug CLI against the retained trusted TLS/PostgreSQL
server; immutable release packaging remains separate.

Real-server selected-field scenario: Windows queued an overlapping offline edit,
Linux changed both title/username, Windows compared the versions without altering
the queue, then selected server title and local username. Linux verified both
chosen fields, default redaction and unchanged explicit password. Final queues
and conflicts were empty. Evidence:
`C:\Projects\127Vaults-sync-web-20261014-a\lifecycle-native.json`;
earlier comparison-only evidence is retained in `lifecycle-cli-compare.json`.

See the [expanded evidence matrix](internal-sync-release-plan-2026-10-13.md),
[artifact inventory](internal-release-artifacts-2026-10-13.json) and
[restart checkpoint](internal-release-restart-2026-10-14.md). Keep committing locally
to main, preserve unrelated work and original queued operations, and do not push.

# Internal acceptance suites

These are opt-in integration and acceptance workflows for isolated, retained
fixtures. They are separate from product unit tests and release/build commands.
They can start test servers, enroll synthetic devices, write encrypted test data,
or exercise interruption and recovery. There is deliberately **no run-all**.

| Suite | Coverage |
| --- | --- |
| `cli` | Packaged CLI enrollment, disclosure, readers and writers |
| `desktop` | Packaged GUI, offline/conflict/multiple-pending and budget recovery |
| `web` | Browser types, web/native sync and vault lifecycle |
| `extension` | Credential handoff, forms and permission boundaries |
| `server` | Package/startup, backup/restore, operations and cloud rehearsal |
| `ownership` | Ownership, administration, stale authorization and customer UI |
| `sync` | Cross-client queues, settings, loss and lifecycle cases |
| `licensing` | Signed-license enforcement, notices, durable queues and renewal |
| `site` | Local public-site acceptance |
| `audit` | Read-only artifact, requirement and saved-evidence verification |
| `support` | Shared inspector and transport interruption proxies |

Discover commands from the repository root:

```powershell
pnpm test:internal
pnpm test:internal --list
pnpm test:internal --list --suite licensing
pnpm test:internal:check
pnpm test:internal:audit
pnpm test:internal:audit:extended
```

`test:internal:check` checks suite layout, syntax, imports and safe discovery;
it does not run application scenarios. The default audit checks current selected
package hashes and the basic functional sanity record. The optional extended
audit reconciles the older detailed matrix and historical guarded fixture state;
it requires the documented Windows/WSL fixtures. Neither starts a server or
accepts a release on its own. Use the functionality-first readiness assessment
for the current internal handoff; partial extended coverage is not automatically
missing functionality.

To explicitly select one workflow (arguments depend on that entry):

```powershell
pnpm test:internal --run member-acceptance-verify -- C:/path/to/candidate --budget
```

Read the entry's guards and current release checkpoint before any mutating run.
Many workflows are single-use evidence sequences tied to exact installation IDs,
profiles and package revisions. A previous success is not permission to replay
mutations or reset a fixture. Preserve ciphertext, queues, original installations
and OS keyrings. Use new isolated fixtures where an existing scenario is exhausted.

`suites.json` maps each entry to its area and former path. The move preserves
workflow names and behavior; imports, subprocess commands and repository roots
now resolve from this directory. Historical generated shell files in external
evidence directories retain their original paths; regenerate through the current
entry point when appropriate instead of rerunning those old shell files.

Add future coverage to a relevant existing suite and share fixture setup where
practical. A new standalone scenario runner should have a concrete coverage need;
do not create a new script merely to record another passing status.

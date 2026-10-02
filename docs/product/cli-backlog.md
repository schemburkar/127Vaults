# CLI backlog

Updated 2026-10-02. The [CLI MVP guide](cli-mvp.md) remains usage documentation; this file owns pending work.

| ID | State | Outcome and acceptance |
| --- | --- | --- |
| CLI-001 | Done | Pin private endpoint trust, enroll by approved code, OPAQUE login, local unlock agent, 30-minute lock and redacted status. Source: `apps/cli/src/lib.rs`, `apps/cli/src/agent.rs`. |
| CLI-002 | Done | List/create private vault, list/get/create/edit login items, typed custom fields, explicit password output, stable human selectors and noninteractive JSON/field input. |
| CLI-003 | Partial | Signed sync transport and encrypted local replica exist; verify a live second-device conflict, restart, offline queue replay and checkpoint rollback path before claiming full offline parity. |
| CLI-004 | Open | Expose explicit `sync` and conflict review/resolution commands over the existing engine; prove no queued edit is silently discarded. |
| CLI-005 | Open | Support the desktop item types and section markers in create/edit/get/list while retaining old login compatibility. |
| CLI-006 | Open | Add CLI device list/revoke and credential rotation only after the server ceremony and safety contract are complete. |
| CLI-007 | Open | Define import/export and recovery commands after formats, key custody and release scope are approved. |
| CLI-008 | Open | Run Windows and Linux packaging, secret-store, terminal/pipe disclosure and clean-machine verification before a first release. |

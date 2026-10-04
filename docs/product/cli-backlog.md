# CLI backlog

Updated 2026-10-02. The [CLI MVP guide](cli-mvp.md) remains usage documentation; this file owns pending work.

| ID | State | Outcome and acceptance |
| --- | --- | --- |
| CLI-001 | Done | Pin private endpoint trust, enroll by approved code, OPAQUE login, local unlock agent, 30-minute lock and redacted status. Source: `apps/cli/src/lib.rs`, `apps/cli/src/agent.rs`. |
| CLI-002 | Done | List/create private vault, list/get/create/edit login items, typed custom fields, explicit password output, stable human selectors and noninteractive JSON/field input. |
| CLI-003 | Partial | Signed sync transport and encrypted local replica exist; verify a live second-device conflict, restart, offline queue replay and checkpoint rollback path before claiming full offline parity. |
| CLI-004 | Partial | Explicit `sync` and conflict list/show/resolve commands are wired to the existing engine. Sync reports remaining pending edits, and conflict resolution requires an explicit server/local choice. Live two-device replay and losslessness evidence remain pending. |
| CLI-005 | Done | Create/edit accept all desktop item types, first-party field IDs and section markers while retaining unmarked login compatibility. Get reports type and redacts password-class fields; list includes all types through the lightweight encrypted index without decrypting bodies. CLI unit tests cover typed and section input. |
| CLI-006 | Open | Add CLI device list/revoke and credential rotation only after the server ceremony and safety contract are complete. |
| CLI-007 | Open | Define import/export and recovery commands after formats, key custody and release scope are approved. |
| CLI-008 | Open | Run Windows and Linux packaging, secret-store, terminal/pipe disclosure and clean-machine verification before a first release. |
| CLI-009 | Partial | Multiple private vaults, all-vault item listing, encrypted synchronized names and collections, collection item listing, and a synchronized default view are implemented. Vault settings queue encrypted changes offline and require explicit review on a divergent server version. `vault default` still manages the older local preference. Verify two-device settings replay, restart, and default-view behavior before closing. |
| CLI-010 | Partial | A synchronized move/archive preference and guarded archive/restore commands exist. Archive preserves encrypted items and journals the exact server request for retry; pending edits, conflicts and unsettled checkpoints block retirement. Implement move with an explicit destination, interruption-safe item mappings, and live two-device verification before closing. |

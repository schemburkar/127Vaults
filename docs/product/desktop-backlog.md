# Desktop backlog

Updated 2026-10-05. Windows-first Tauri client; see [desktop scope](../../apps/desktop/README.md). The shell now reflows below 850px with an expandable vault/action menu and switches between list and detail below 620px. Item actions and conflict choices wrap in compact windows; manual unlocked narrow-window verification remains to be done.

| ID | State | Priority | Outcome and acceptance |
| --- | --- | --- | --- |
| DESK-001 | Done | Baseline | Reuse Rust session and encrypted replica for online/offline unlock, queued encrypted edits and explicit sync. Vault selector switches the displayed replica and explicit sync refreshes that selection. Source: `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src/app.tsx`. |
| DESK-002 | Done | Baseline | First-party item types, typed sections, Wi-Fi QR, field-level conflict choice and secret reveal/copy controls are present. |
| DESK-003 | Partial | P2 | Outbound text drag is an integrated development experiment. Complete the manual target matrix, revocable native payload, OS lock signal and accessibility review before a release claim. |
| DESK-004 | Open | P1 | Verify field-aware pending-operation rebase, delete/edit conflicts and checkpoint rollback with two real devices and restart. |
| DESK-005 | Open | P1 | Add supported packaging, signed updates and clean-machine installation for Windows; define macOS/Linux support separately. |
| DESK-006 | Open | P1 | Finish desktop device lifecycle and credential rotation UX once server ceremonies and recovery policy are ready. |
| DESK-007 | Open | P1 | Complete secret exposure review of WebView, clipboard, drag provider and local storage with independent review before production use. |
| DESK-008 | Implemented; verification pending | P1 | Multiple private vaults, encrypted names, saved collections, all-vault and collection item views, and a synchronized default view are implemented. The desktop uses only the synchronized default view; the older local default-vault preference remains CLI-only. New item destination is automatic in a single-vault view and explicit in combined views. Offline settings changes queue locally and divergent server settings require review. Verify offline, restart, and two-device behavior before marking Done. |
| DESK-009 | Implemented; verification pending | P2 | Desktop offers archive or an explicit move destination, shows pending plans with resume/abort controls, and restores archived vaults. The shared Rust session re-encrypts moved items under the destination key, verifies signed destination history, and retries interrupted final requests from a durable journal. Archive keeps encrypted source items; retirement refuses pending edits and conflicts. Desktop and CLI checks pass. Run a live desktop walkthrough with two devices, interruption during copying/finalization, restore, and pending-edit rejection before marking Done. Move currently has a 50-item server limit. |

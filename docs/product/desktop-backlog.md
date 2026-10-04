# Desktop backlog

Updated 2026-10-04. Windows-first Tauri client; see [desktop scope](../../apps/desktop/README.md). The shell now reflows below 850px and switches between list and detail below 620px; manual narrow-window verification remains to be done.

| ID | State | Outcome and acceptance |
| --- | --- | --- |
| DESK-001 | Done | Reuse Rust session and encrypted replica for online/offline unlock, queued encrypted edits and explicit sync. Vault selector switches the displayed replica and explicit sync refreshes that selection. Source: `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src/app.tsx`. |
| DESK-002 | Done | First-party item types, typed sections, Wi-Fi QR, field-level conflict choice and secret reveal/copy controls are present. |
| DESK-003 | Partial | Outbound text drag is an integrated development experiment. Complete the manual target matrix, revocable native payload, OS lock signal and accessibility review before a release claim. |
| DESK-004 | Open | Verify field-aware pending-operation rebase, delete/edit conflicts and checkpoint rollback with two real devices and restart. |
| DESK-005 | Open | Add supported packaging, signed updates and clean-machine installation for Windows; define macOS/Linux support separately. |
| DESK-006 | Open | Finish desktop device lifecycle and credential rotation UX once server ceremonies and recovery policy are ready. |
| DESK-007 | Open | Complete secret exposure review of WebView, clipboard, drag provider and local storage with independent review before production use. |
| DESK-008 | Partial | Multiple private vaults, encrypted names, saved collections, all-vault and collection item views, and synchronized default view are implemented. New item destination is automatic only for a single vault and explicit in combined views. Offline settings changes queue locally and divergent server settings require review. Verify offline, restart, and two devices; reconcile the older local default-vault preference with the synchronized default view. |
| DESK-009 | Partial | A synchronized ask/move/archive preference is exposed. Implement removal with a chosen move destination or recoverable archive. Move re-encrypts each item under the destination key, verifies signed destination history, then retires the source without loss on interruption. Archive preserves encrypted items in their source vault. Refuse final retirement with pending edits or conflicts. |

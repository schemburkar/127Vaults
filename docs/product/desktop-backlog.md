# Desktop backlog

Updated 2026-10-02. Windows-first Tauri client; see [desktop scope](../../apps/desktop/README.md).

| ID | State | Outcome and acceptance |
| --- | --- | --- |
| DESK-001 | Done | Reuse Rust session and encrypted replica for online/offline unlock, queued encrypted edits and explicit sync. Vault selector switches the displayed replica and explicit sync refreshes that selection. Source: `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src/app.tsx`. |
| DESK-002 | Done | First-party item types, typed sections, Wi-Fi QR, field-level conflict choice and secret reveal/copy controls are present. |
| DESK-003 | Partial | Outbound text drag is an integrated development experiment. Complete the manual target matrix, revocable native payload, OS lock signal and accessibility review before a release claim. |
| DESK-004 | Open | Verify field-aware pending-operation rebase, delete/edit conflicts and checkpoint rollback with two real devices and restart. |
| DESK-005 | Open | Add supported packaging, signed updates and clean-machine installation for Windows; define macOS/Linux support separately. |
| DESK-006 | Open | Finish desktop device lifecycle and credential rotation UX once server ceremonies and recovery policy are ready. |
| DESK-007 | Open | Complete secret exposure review of WebView, clipboard, drag provider and local storage with independent review before production use. |
| DESK-008 | Partial | Multiple private vaults can be created and selected. All-items view combines item summaries and requires a destination vault for new items. A local default vault opens on unlock. Finish encrypted synchronized vault names, saved collections with membership and a default view, and safe removal. New item destination is automatic only when exactly one vault is selected. In a combined view it is explicit. Unavailable collection members remain visible as unavailable. Verify offline, restart and two devices. |
| DESK-009 | Open | Vault removal offers move all items to a chosen vault or archive all items, with a saved preference. Move re-encrypts each item under the destination key, verifies signed destination history, then retires the source without loss on interruption. Archive preserves recoverable encrypted items in their source vault. Refuse final retirement with pending edits or conflicts. Never delete items as a side effect. |

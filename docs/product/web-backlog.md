# Web backlog

Updated 2026-10-02. State is based on the current source and recorded evidence; it does not imply a supported release. The desktop's richer item model is the parity target where browser behavior makes sense.

| ID | State | Outcome and acceptance |
| --- | --- | --- |
| WEB-001 | Done | Owner and invite onboarding, OPAQUE unlock, private vault and encrypted login item create/read/update. Source: `apps/web/src/app.tsx`, `apps/web/mvp-client.mjs`; [browser evidence](../release/browser-mvp-evidence.md). |
| WEB-002 | Done | Trusted device listing, CLI approval and revocation controls, explicit lock, sync action and a basic conflict dialog exist in the web UI. |
| WEB-003 | Open | Read the desktop encrypted item-type and section markers; create, edit and display all first-party types and grouped fields. Existing login items must remain readable. |
| WEB-004 | Open | Show a Wi-Fi join QR from locally decrypted fields, with escaping and a manual reveal action. |
| WEB-005 | Open | Match desktop conflict comparison: field choices, clear delete/edit handling, one save action, and fresh verified replica after accepted save. Verify two-device divergence. |
| WEB-006 | Open | Decide and implement a browser local replica/unlock policy if offline web is in scope. Verify restart, stale checkpoint, queued edit and lock behavior before claiming offline support. |
| WEB-007 | Open | Finish browser-native device enrollment and private-LAN certificate/trust matrix; record a human browser ceremony after local CA trust. |
| WEB-008 | Open | Complete browser security, accessibility and cross-browser verification for supported features before a first release. |

OS-level outbound secret dragging is a desktop capability, not a browser parity promise. Browser drag to another tab is a separate product decision.

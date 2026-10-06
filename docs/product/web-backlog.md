# Web backlog

Updated 2026-10-05. State is based on the current source and recorded evidence; it does not imply a supported release. The desktop's richer item model is the parity target where browser behavior makes sense.

| ID | State | Priority | Outcome and acceptance |
| --- | --- | --- | --- |
| WEB-001 | Done | Baseline | Owner and invite onboarding, OPAQUE unlock, private vault and encrypted login item create/read/update. Source: `apps/web/src/app.tsx`, `apps/web/mvp-client.mjs`; [browser evidence](../release/browser-mvp-evidence.md). |
| WEB-002 | Done | Baseline | Trusted device listing, CLI approval and revocation controls, explicit lock, sync action and a basic conflict dialog exist in the web UI. |
| WEB-003 | Implemented, verification pending | P1 | The web form and details now share desktop type and section definitions, preserve absent markers as login, and create, edit and display first-party types and grouped fields. A browser round trip with desktop-created items is still needed. |
| WEB-004 | Implemented, verification pending | P2 | Wi-Fi details now reveal a locally generated join QR on request, escaping Wi-Fi separators. A real scanner check is still needed. |
| WEB-005 | Partial | P1 | The web conflict dialog has per-field choices and saves the selected version immediately. A remote deletion offers save as a new item or accept deletion. Accepted saves reload and verify the catalogue revision and saved item. Two-device divergence and delete/edit behavior still need live verification. |
| WEB-006 | Open | P2 | Decide and implement a browser local replica/unlock policy if offline web is in scope. Verify restart, stale checkpoint, queued edit and lock behavior before claiming offline support. |
| WEB-007 | Open | P0/P1 | Finish browser-native device enrollment and private-LAN certificate/trust matrix; record a human browser ceremony after local CA trust. |
| WEB-008 | Open | P1 | Complete browser security, accessibility and cross-browser verification for supported features before a first release. The narrow layout now has item-list return navigation, persistent edit actions, mobile sync, and compact settings navigation. |
| WEB-009 | Partial | P1 | After online unlock, the web client reads the authenticated server license status and labels experimental enforcement. Add a persistent, accessible plan/expiry/grace/lock notice and corresponding write-state UI after SRV-018 enforcement is reviewed. Preserve separate public-site customer identity and invite-only vault registration. Verify renewal and stale-session behavior. |
| WEB-010 | Open | P0 for Cloud | Add authenticated regional Cloud discovery and tenant-aware enrollment/login only after SRV-019 runtime contracts are frozen. Bind browser session, cookie/storage, CSRF and unlocked state to canonical origin and tenant; lock and clear state on tenant switch or region move. Prove wrong-host/session/payload rejection and self-hosted compatibility. Cloud remains internal until launch gates pass. |

Browser offline policy: this iteration keeps the web session server-backed and does not persist a decrypted replica or an offline edit queue. Offline browser support remains in WEB-006 until an encrypted storage, unlock, stale-checkpoint, queue and lock policy is implemented and verified.

OS-level outbound secret dragging is a desktop capability, not a browser parity promise. Browser drag to another tab is a separate product decision.

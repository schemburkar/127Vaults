# Web backlog

Updated 2026-10-13. State is based on the current source and recorded evidence; it does not imply a supported release. The desktop's richer item model is the parity target where browser behavior makes sense.

| ID | State | Priority | Outcome and acceptance |
| --- | --- | --- | --- |
| WEB-001 | Done | Baseline | Owner and invite onboarding, OPAQUE unlock, private vault and encrypted login item create/read/update. Source: `apps/web/src/app.tsx`, `apps/web/mvp-client.mjs`; [browser evidence](../release/browser-mvp-evidence.md). |
| WEB-002 | Done | Baseline | Trusted device listing, CLI approval and revocation controls, explicit lock, sync action and a basic conflict dialog exist in the web UI. |
| WEB-003 | Implemented, verification pending | P1 | The web form and details now share desktop type and section definitions, preserve absent markers as login, and create, edit and display first-party types and grouped fields. A browser round trip with desktop-created items is still needed. |
| WEB-004 | Implemented, verification pending | P2 | Wi-Fi details now reveal a locally generated join QR on request, escaping Wi-Fi separators. A real scanner check is still needed. |
| WEB-005 | Partial | P1 | The web conflict dialog has per-field choices and saves the selected version immediately. A remote deletion offers save as a new item or accept deletion. Accepted saves reload and verify the catalogue revision and saved item. Two-device divergence and delete/edit behavior still need live verification. |
| WEB-006 | Implemented PWA; acceptance partial | P1 internal | Installed-PWA policy supports encrypted local storage, offline unlock/restart, queued edits, explicit conflict review and lock clearing. Edge Rust/WASM fixture passes offline restart, lost-response replay, archive/restore/move and ownership acceptance. Ordinary browser sessions remain online-only. Intended-host and wider browser acceptance remain open. See [evidence](../release/internal-release-readiness-2026-10-13.md). |
| WEB-007 | Implemented enrollment; ceremony partial | P1 | Browser-native enrollment is implemented; live Rust/PostgreSQL enrollment and browser crypto fixtures pass. Complete intended-host CA trust, private-LAN matrix and recorded human browser ceremony. See [evidence](../release/internal-release-readiness-2026-10-13.md). |
| WEB-008 | Open | P1 | Complete browser security, accessibility and cross-browser verification for supported features before a first release. The narrow layout now has item-list return navigation, persistent edit actions, mobile sync, and compact settings navigation. |
| WEB-009 | Partial | P1 | After online unlock, the web client reads the authenticated server license status and labels experimental enforcement. Add a persistent, accessible plan/expiry/grace/lock notice and corresponding write-state UI after SRV-018 enforcement is reviewed. Preserve separate public-site customer identity and invite-only vault registration. Verify renewal and stale-session behavior. |
| WEB-010 | Open | P0 for Cloud | Add authenticated regional Cloud discovery and tenant-aware enrollment/login only after SRV-019 runtime contracts are frozen. Bind browser session, cookie/storage, CSRF and unlocked state to canonical origin and tenant; lock and clear state on tenant switch or region move. Prove wrong-host/session/payload rejection and self-hosted compatibility. Cloud remains internal until launch gates pass. |

Browser offline policy: ordinary browser sessions remain server-backed. Installed PWA sessions may retain a verified encrypted replica and encrypted pending queue; decrypted state clears on lock. WEB-006 records the remaining acceptance scope.

OS-level outbound secret dragging is a desktop capability, not a browser parity promise. Browser drag to another tab is a separate product decision.

## Internal release acceptance — 2026-10-13

Windows and Linux, all client surfaces and admin writes are explicitly selected. See the [current evidence and remaining gates](../release/internal-release-readiness-2026-10-13.md). Implementation and narrower tests do not close wider acceptance rows. The candidate remains fictitious-data-only.

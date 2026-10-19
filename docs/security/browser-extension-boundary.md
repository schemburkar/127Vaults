# Browser extension boundary (experimental)

Updated 2026-10-08. This describes the current Chrome/Edge Manifest V3 connector in `apps/extension` and its remaining verification. It is not a production security approval.

## Trust and data flow

The connector can use an unlocked server-hosted web app, an active desktop/CLI unlock agent, with their installed encrypted replicas. The extension persistently stores its configured HTTPS web origin and public legacy provider origins and an all-HTTPS-sites passkey-provider setting. The passkey provider requests optional permission for all HTTPS sites once when enabled. It asks Chromium for that host permission when the user connects it. The extension lists item indices from the selected source, requests one verified body only after the user selects a login, then fills one frame of the active page. No credential database, account secret, master password, vault key or password is persisted by the extension; the selected password exists transiently in popup memory and the target input. Installed clients own the encrypted replica and integrity state.

Offline fill uses a hydrated Desktop/CLI profile unlocked in its client. The password connector exposes discovery, list, get and lock; it accepts no username, account-secret or master-password fields and cannot unlock a profile. Passkey creation and selected-key retrieval require Desktop's current verified unlock session, obtained from the authenticated local agent and checked at execution and before website success. Older or unavailable agents block approval without a password fallback. Creation uses the existing encrypted mutation queue, including offline. Offline data may be stale; revocation cannot reach a disconnected client. Native messaging registration, profile ownership, active-agent lifecycle and rollback behavior require live review.

The extension's popup is short lived and its background worker retains a native port but no credential strings between requests. The native host holds no independent unlock session; it delegates to the client agent, which expires on lock, exit or its inactivity timeout. The worker listens for Chromium idle and OS-lock events and asks open vault tabs and the native host to lock. The web bridge executes in the vault page's MAIN world because it must reach that session. The target-page probe and fill execute in an isolated world. The saved website, current tab, selected frame and newly fetched credential must all match the exact HTTPS origin, including port. The probe sends no secret. Cross-origin frames and ambiguous password forms are refused. The extension never submits a form.

## Known limits and review points

- A malicious or compromised vault web page can call the page-global bridge and access the unlocked session. This is part of the existing server-delivered web-client trust boundary; the extension adds another bridge and needs independent review before public release.
- Once a password is placed in a page input, scripts on that destination page can read it. The destination page can also alter inputs between probe and fill. The fill checks origin again immediately before setting values, but cannot make a malicious same-origin page safe.
- Chromium host permissions cover the vault hostname across ports. The extension selects a tab only at the configured exact origin. Review the runtime permission prompt and tab selection in both browsers.
- Native messaging grants the registered extension ID a local host connection. Review installation, host binary provenance, OS credential access, unlocked-agent ownership and error redaction. Unlock happens in the selected client; the extension does not send account secrets or master passwords to the host.
- Browser memory and injected page input values cannot be reliably zeroized. Lock removes access to future vault reads; it cannot retract a value already filled into a page.
- Forms inside closed shadow roots, cross-origin frames, canvas controls and browser privileged pages are unsupported. A site matrix must record successes and failures. Do not advertise universal fill.
- No automatic fill, automatic submit, save/update prompt or password generation is enabled. Editing remains outside extension scope. Website passkeys use the separate [passkey security design](website-passkeys.md) and require independent review before a supported release. TOTP filling remains outside this connector slice.

## Browser acceptance matrix

Run in Chrome and Edge with sample credentials and an unpacked build before closing EXT-003/005:

| Case | Expected result |
| --- | --- |
| Ordinary form with username/password | Both fields fill; input/change listeners fire; no submit |
| Username page followed by password page | Each step fills after a separate user click |
| React controlled form and open shadow-root form | Values remain after rerender; selected fields fill |
| Same-origin iframe | Probe finds it; selected frame alone receives secret |
| Cross-origin iframe or changed tab origin | No credential passed to that frame/page |
| Ambiguous multiple-password or new-password form | Refusal; no field changes |
| Locked/closed/restarted web tab with installed desktop/CLI replica | Local connector unlock and fill still work |
| Server stopped after installed-client sync | Local connector unlock and fill still work; no write request is sent |
| Tampered or rolled-back local snapshot | Reject it and keep the last verified snapshot; never show unverified data |
| Phishing lookalike, subdomain and HTTP downgrade | No matching login offered |
| More than one matching login | User chooses explicitly; no automatic fill |

Inspect extension storage, requests and logs for secret material. Review the permission prompt, active-tab lifetime, browser restart and OS lock behavior. Record exact browser versions and evidence in the [extension backlog](../product/extension-backlog.md).

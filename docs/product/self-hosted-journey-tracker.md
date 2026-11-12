# Self-hosted journey: usability review and remaining work

Reviewed: 2026-11-12. Source baseline: `7c88f43`.

The goal is that an ordinary household or small-team operator can set up, share, maintain and recover a self-hosted server, and a joining user can open their vault without learning our infrastructure. An implementation checkbox is not proof that this journey is easy.

The original [50-point implementation record](self-hosted-ease-worklist.md) remains useful history. This tracker supersedes its completion claim for **usability and release readiness**. This review inspected code and existing test evidence; it did not run a new clean-machine or observed-user acceptance session. “Prove” below means evidence is still needed, not that a defect has been demonstrated.

Review result: **10 foundations to keep, 32 points needing usability follow-through, and 8 needing stronger acceptance evidence**. The execution queue contains **22 open tasks**, mapped to all 50 original points. No implementation change or new host acceptance run was performed in this review.

## What success looks like

- The operator follows the installer and product screens, without typing routine commands, finding internal IDs, or editing configuration files. An advanced command-line route remains available.
- A recipient gets clear joining instructions, installs a client, confirms the expected server, creates or uses their account, approves the device and opens a vault. They never need the purchaser's Manage account, setup credential or license material.
- First-time account creation explains that its newly trusted browser session can approve Desktop on the same computer. “Use another trusted device” is an alternative, not an unexplained prerequisite for a new user.
- Interrupted setup returns to the next unfinished step. “Ready” reflects a dated successful check where possible; personal acknowledgements such as saving recovery material are labeled separately.
- The operator can see whether backups are actually running, act on certificate or license problems, and recover when the server cannot start.
- Preserve certificate validation, installation identity, explicit device approval, protected downloads and separate operator/vault credentials while reducing the work people must do.

In acceptance sessions record manual commands, copied paths/IDs, separate links/files, certificate prompts, context switches, failed steps and whether help from a developer was needed. Establish the baseline before choosing time targets. Keep these observations local; this does not authorize product telemetry or production test emails.

## Review of every original point

**Keep:** foundation is appropriate; retain its protections. **Improve:** source shows remaining manual work or incomplete guidance. **Prove:** implementation exists but its intended outcome needs packaged/real-device acceptance. All three still participate in the final journey test. Task IDs refer to the actionable queue below.

### 1. Combined installer

| Original | Assessment | Remaining checkpoint |
| --- | --- | --- |
| 1.1 Role-based entry | Prove | A new operator and joining user independently choose the correct role; repair never becomes fresh setup. J01, J02. |
| 1.2 Recommended components | Improve | Explain what each role actually needs; separate required, optional and already working components. J17. |
| 1.3 Connection-file input | Improve | Remove path copying with a supported file-selection/handoff flow; keep manual input available. J03, J17. |
| 1.4 Preflight/restart guidance | Improve | Current preview primarily reports runtime/engine needs. Add storage/free-space/access checks and a direct retry/resume path after reboot. J17. |
| 1.5 Resume completed steps | Prove | Interrupt real downloads, prerequisite installation, component installation and server startup; resume without duplicate activation or changed identity. J01, J06. |

### 2. Joining users

| Original | Assessment | Remaining checkpoint |
| --- | --- | --- |
| 2.1 Protected client downloads | Keep | Keep client-only access boundaries; test a recipient who has no purchaser session. J02. |
| 2.2 Shareable joining page | Improve | The operator still assembles an invitation, download link and attached connection file. Present one coherent sharing ceremony without merging their authority. J03. |
| 2.3 Explain the three steps | Improve | Explain new-account versus existing-account paths, including approval from the same newly trusted browser session. J04, J08. |
| 2.4 OS recommendation | Prove | Verify real Windows/Linux package choices, architecture and unsupported-platform messaging with published catalogue data. J02, J22. |
| 2.5 Completion checklist | Improve | Current browser ticks are local notes shared under one storage key. Scope/reset them for the current journey and separate notes from app-confirmed progress. J06. |

### 3. Desktop

| Original | Assessment | Remaining checkpoint |
| --- | --- | --- |
| 3.1 Staged first run | Improve | Explicitly show checking, connected, account needed, approval pending and ready. A failed owner-status check currently falls back to the non-owner path without explaining that status is unknown. J04. |
| 3.2 Primary file import | Keep | Keep verified file import primary and manual settings advanced. Prove attachment-to-app handoff. J03, J02. |
| 3.3 Recognizable server identity | Improve | Retain a recognizable display name after import and show the exact configured server and verification details in a discoverable settings view. J20. |
| 3.4 Pending approval | Improve | Add explicit cancellation, expiry, retry and recovery guidance. Current UI polls until completion/error and disables navigation while waiting. J05. |
| 3.5 Resume without credentials | Prove | Close/reopen at each onboarding step; retain only appropriate public progress and never require a reset of saved trust. J06, J02. |

### 4. Web app

| Original | Assessment | Remaining checkpoint |
| --- | --- | --- |
| 4.1 Invitation-led registration | Keep | Retain server-bound invitation and email verification ceremonies. Test expired, redeemed and wrong-server invitations in the full joining journey. J02, J18. |
| 4.2 First-owner gating | Keep | Retain server-confirmed first-owner gating; make unavailable status distinct from an existing owner. J04, J01. |
| 4.3 Recovery/vault/device checklist | Improve | Current recovery acknowledgement is a browser-wide note. Make progress account-aware, distinguish acknowledgement from verified state, and lead to the first saved item. J19. |
| 4.4 Reviewed device approval | Prove | A first-time user can find approval, compare the device and code, then return to Desktop successfully. Test same-computer and second-device paths. J02, J05. |
| 4.5 Post-registration guidance | Improve | Move beyond “ask your administrator”: preserve the applicable joining context and offer a direct next action without storing invitation credentials. J03, J04, J19. |

### 5. Server admin

| Original | Assessment | Remaining checkpoint |
| --- | --- | --- |
| 5.1 Add a person | Improve | Make invitation creation through successful joining one guided flow; avoid separate optional buttons and missing attachments. J03, J18. |
| 5.2 Share connection/message | Improve | Automatically assemble the available pieces after explicit authorization; provide clipboard/file fallbacks and accurate link-expiry information. Trial/dev operators currently may need a link from Manage. J03, J18. |
| 5.3 Invitation lifecycle | Improve | Existing status tables are useful; add the safe next action for expired/revoked invitations and download grants, with a preview of what will be replaced or invalidated. J18. |
| 5.4 Reachability | Improve | Current code classifies loopback versus a configured private address; it does not prove recipient reachability. Add a real client-side connection check and label its evidence honestly. J07. |
| 5.5 Readiness checklist | Improve | Turn the overview's instructions into next-step actions; distinguish unknown/stale evidence from a healthy installation. Include enrollment email and backup readiness. J06, J11, J21. |

### 6. Browser extension

| Original | Assessment | Remaining checkpoint |
| --- | --- | --- |
| 6.1 Detect/recommend source | Prove | Exercise Desktop-only, CLI-only, both, locked, offline and unavailable connectors in an installed browser. J10, J22. |
| 6.2 Remember preference | Keep | Keep the non-secret preference and explicit fallback explanation; verify persistence through browser restart. J22. |
| 6.3 Open/unlock/reconnect | Improve | Give one appropriate next action for missing host, locked client, lost connection and stale web tab; avoid making users diagnose the source themselves. J10, J16. |
| 6.4 Guided install/repair | Improve | The current route still requires Developer mode, Load unpacked and copying extension IDs. Complete normal distribution and a narrowly scoped connector repair flow. J10. |
| 6.5 Store preparation | Improve | Review metadata exists; store submission, real extension IDs, signed-build verification and discoverable install links remain separate work. Do not advertise an unpublished store link. J10, J22. |

### 7. Installation handoff

| Original | Assessment | Remaining checkpoint |
| --- | --- | --- |
| 7.1 Component results | Keep | Keep component-specific results, with failure and next action beside the affected component. J06. |
| 7.2 Installed/setup/ready | Improve | “Ready” currently can be a user confirmation. Add actual health/enrollment/connector evidence, its check time, and an honest unknown state. J06. |
| 7.3 Correct next action | Improve | Desktop has a launch offer; complete the appropriate owner/Admin, joining, CLI and browser handoffs without asking users to locate paths. J04, J06, J17. |
| 7.4 Public connection handoff | Keep | Keep public-file-only handoff and explicit trust review. Do not pass purchaser credentials or silently replace existing trust. J03, J02. |
| 7.5 Resumable checklist | Improve | `--review-setup` and JSON are useful operator fallbacks, but the normal journey needs a discoverable resume screen with the next unfinished action. J06. |

### 8. Connection failures

| Original | Assessment | Remaining checkpoint |
| --- | --- | --- |
| 8.1 Network/Tailscale help | Improve | Current shared helper primarily translates strings into advice. Offer bounded retry/check-network actions using structured failure reasons. J07, J16. |
| 8.2 Identity changes | Keep | Preserve immutable trust and encrypted local work; offer inspection/comparison guidance without a one-click unsafe reset. J16, J20. |
| 8.3 Account/device failures | Improve | Preserve generic sign-in responses, but make authenticated pending/expired/revoked states lead to the correct supported recovery action. J05, J09, J16. |
| 8.4 License guidance | Improve | Explain operator versus ordinary-user responsibility; expose read-only plan/expiry/grace and live/offline freshness in Desktop without license credentials. J20. |
| 8.5 Redacted report | Improve | Keep the allowlist. Add useful build/version, check time and stable failure identifiers where safe; show a preview before sharing. J16. |

### 9. Browser certificate trust

| Original | Assessment | Remaining checkpoint |
| --- | --- | --- |
| 9.1 App/browser distinction | Keep | Keep the distinction and prohibit certificate bypass. Make it visible exactly where a user encounters it. J08. |
| 9.2 Platform guides | Prove | Walk through current supported Windows/Linux browsers on clean hosts, including managed-policy refusal and no administrator privileges. J08, J22. |
| 9.3 Public CA export | Keep | Keep public-only export and exact-file fingerprint explanation; make verification steps available alongside the file. J08. |
| 9.4 Other trusted device | Improve | Present both same-computer trusted browser and another-device approval routes, including what to do when there is no surviving trusted device. J05, J08, J09. |
| 9.5 Browser connection check | Prove | Its same-origin HTTPS check is useful only once the browser can load the app. Test the earlier certificate-blocked case and guide users without requiring that blocked page to work. J07, J08, J22. |

### 10. Server ownership

| Original | Assessment | Remaining checkpoint |
| --- | --- | --- |
| 10.1 Backup scheduling | Improve | A local command wizard exists, but routine setup still needs paths and a terminal. Add a discoverable guided surface with schedule view/edit/pause and supported unattended operation. J11, J12. |
| 10.2 Backup visibility | Improve | Add schedule/next-run/staleness, early failures and full database-plus-identity coverage. Current failure recording starts after key/config/engine discovery succeeds. J12. |
| 10.3 Certificate renewal | Improve | Show due/overdue action in the normal UI and preserve same-CA renewal through failure/retry; current renewal is a local command ceremony. J11, J15. |
| 10.4 Update preview | Improve | Preserve existing compatibility and backup checks, but remove routine path entry and guide backup-schedule transition and post-update verification. J14. |
| 10.5 Restore/migrate | Improve | Existing guards are valuable, but the wizard still asks for a UUID and several paths. Offer backup-pair selection, metadata preflight and server-down recovery; test it on another host. J09, J13, J22. |

## Actionable follow-up queue

All items below are **open**. A checkbox closes only when the outcome and its stated acceptance evidence are recorded. Tasks involving publication or external accounts are separately gated; listing them does not perform or authorize an external submission.

### P1 — finish the first successful journey

- [ ] **J01 · Prove the operator journey.** Use coordinated packages on fresh supported Windows and Linux hosts, with no development tools. Complete paid Personal and trial setup, first local operator, first vault owner, first vault, restart and resume. Record every manual command/path/ID and turn friction into specific defects. No production test email or synthetic production signup.
- [ ] **J02 · Prove a second person can join.** Separate computer and non-purchaser account: protected download → connection import → invitation registration or existing account → device approval → first unlock → create/read/sync an item. Include same-computer browser approval, approval from another device, expired link and interrupted setup. Preserve original trust on every failure.
- [ ] **J03 · Make one coherent joining kit.** Guide the operator through assembling the account invitation, expiring client-only download access and public connection file. Offer a clear share/export action and recipient next steps; remove avoidable Manage round-trips and path copying. Keep each capability's scope and lifetime distinct. Accept only after a recipient completes the flow without asking which link/file to use.
- [ ] **J04 · Finish Desktop's joining state machine.** Explicit unknown/checking/error states; clear new-account/existing-account/first-owner paths; retry setup discovery; return from registration to enrollment and first unlock. Show the verified server throughout. Accept after closing/reopening at each step without credentials persisted or trust reset.
- [ ] **J05 · Make device approval recoverable.** Visible expiry, cancel, retry and return-to-app actions; handle a closed browser, network loss, denial/revocation and app restart. Cancel the corresponding native wait safely, not just its screen. Explain same-computer approval. Accept with real packaged clients and with no newly approved identity after cancellation/expiry.
- [ ] **J06 · Replace checklist files with a normal resume experience.** One discoverable next-step view, with component receipts, dated live checks, explicit unknown states and separate user acknowledgements. Scope/reset joining notes so one completed installation does not complete another. Keep command/JSON fallbacks. Accept after interruption/reboot and after an installed component becomes unavailable.
- [ ] **J07 · Check connectivity from the computer that must connect.** Bounded checks for the chosen address, private network/Tailscale, TLS and server response; distinguish configured address from successful reachability. Give a usable route when the browser cannot yet load the server page. Accept on a real second computer with server down, wrong network, wrong address and certificate failure; never bypass TLS or scan unrelated peers.
- [ ] **J08 · Guide certificate trust at the right moment.** Platform-specific steps beside the exact public CA/fingerprint; same-computer versus trusted-other-device approval explanation; managed-browser refusal guidance. Evaluate native invitation-based account setup as a separate design option to reduce browser CA work, preserving the existing verification/approval rules. Accept via clean-host walkthroughs, not only documentation review.
- [ ] **J21 · Rewrite first-time guidance around roles.** Distinct “I run the server” and “I am joining” paths, paid versus trial setup, account versus operator identity, first save and extension setup. Remove unconditional trial activation language from paid instructions. Produce a printable local recovery record without keys, passwords or capabilities. Accept when a new tester follows the relevant path without opening the advanced runbook.

### P2 — make everyday ownership and recovery manageable

- [ ] **J09 · Define and implement supported loss recovery.** Separate lost operator password, lost trusted device, lost backup key and lost installation identity. Reuse existing recovery mechanisms; never imply the operator can recover another user's encryption keys. Include server-down entry and explicit license replacement/retirement where needed. Accept each supported path with a disposable installation and clearly label unrecoverable cases.
- [ ] **J10 · Finish normal extension installation and repair.** Complete store review/submission prerequisites, track actual published IDs, verify signed builds, then show accurate installation links. Reduce manual ID registration through narrowly scoped installer integration and give actionable connector status/repair. Until publication, label the developer-mode path accurately. External publication remains a separate release action. Accept install/fill/lock/reconnect/removal in each supported browser.
- [ ] **J11 · Put maintenance within the normal local journey.** Offer typed, reviewed actions through the installer/local operator surface for backup setup, rehearsal, renewal and recovery. Reuse existing scripts; no arbitrary shell/container interface in the browser. Keep advanced commands. Accept when the operator completes routine work without copying commands or paths from documentation.
- [ ] **J12 · Make backup status trustworthy and schedules maintainable.** View/edit/pause/remove/retry a schedule; display next run, last attempt and stale/unknown status. Record early failures such as missing key, engine offline or inaccessible destination. Separate complete database/identity pairs from partial output and record the corresponding restore check. Handle signed-out Windows/Linux service availability and interrupted registration. No automatic pruning without a reviewed retention policy and a verified recoverable copy. Accept after reboot, missed run, disk failure and schedule change.
- [ ] **J13 · Select a recovery set instead of typing its internals.** Read and validate backup metadata; identify matching database/identity/key material and supported schema before any mutation; guide selection of a new target. Keep installation binding and empty-target guards. Preserve the original host. Accept a real replacement-host recovery followed by login/read/sync from an existing client.
- [ ] **J14 · Make updates one reviewed workflow.** Discover the existing bundle/engine/provider, show compatibility/backup/downtime, run established upgrade checks, transition the backup schedule with explicit review and surface post-update client verification. Accept success and interrupted/failed upgrade, preserving old data, identities and appropriate rollback limits.
- [ ] **J15 · Make certificate expiry and network change actionable.** Show renewal due state and a reviewed same-CA renewal action with failure/retry guidance. Add a separately backed-up private-address/hostname migration path for existing installs, retaining local Admin recovery and explaining client reconnection. Accept leaf renewal and a controlled LAN migration without resetting trust or opening public exposure.
- [ ] **J16 · Turn error explanations into supported actions.** Prefer stable typed failure reasons over broad string matching; offer the relevant bounded retry/open-client/check-network/device-review action. Keep generic unauthenticated responses. Preview redacted reports with safe build/version/time/failure metadata; test field allowlists and actual usefulness. Accept by inducing each supported failure and recovering through the offered action.
- [ ] **J17 · Remove installer guesswork.** Clarify recommendations, show storage location/free space/access, discover engine/provider safely, support file selection, label OS permission/reboot steps and resume at the failed component. Accept on fresh Windows/Linux and restricted/missing-disk installations without copied paths or accidental server installation for a joining user.
- [ ] **J18 · Complete invitation and download-link lifecycle actions.** Reissue/revoke/replace with clear expiry and consequences; distinguish account invitation from client-download grant; handle trial/dev delegation without purchaser credential sharing. Include enrollment-email setup/rotation and redacted delivery/failure guidance, using captured mail for tests. Preview affected links and keep applicable audit/ownership checks. Accept expired/redeemed/revoked cases and unchanged unrelated access.
- [ ] **J19 · Lead from account creation to a useful vault.** Offer first vault/item, recovery acknowledgement and next-device/extension actions; scope progress to the right account without storing secrets or claiming a recovery backup was verified. Accept with a brand-new user, an existing user and a shared browser.
- [ ] **J20 · Make server and entitlement context readable.** Persist a recognizable server name alongside verified identity; show the configured server and read-only plan/expiry/grace with live/offline freshness. Explain who can fix a license problem. A different connection file must preserve existing trust and offer a safe explanation, never overwrite it silently. Accept with active, expired, offline and mismatched-server cases.

### Release acceptance — close the journey, not just the tickets

- [ ] **J22 · Run and retain packaged acceptance evidence.** Windows/Linux; same-computer/LAN/Tailscale where supported; new owner/new member/existing member; Desktop/CLI/web/extension; fresh/restart/update/recovery. Reuse scripted fixtures and local captured mail. Include keyboard access, narrow screens, copy fallbacks and unavailable OS credential storage. Record package versions, source revision, receipts and unresolved defects. Re-run affected paths after fixes. Do not substitute source-build tests for distributed-package acceptance, and do not publish until the established coordinated release gates pass.

## Suggested execution order

1. Run J01/J02 far enough to record a baseline; fix blockers exposed by those sessions.
2. Complete joining/handoff work J03–J08 and role guidance J21. This is the highest immediate benefit for the original request.
3. Complete first-use and routine ownership work J19/J20, J11/J12/J17/J18, followed by J09/J13–J16. Progress J10 independently when store prerequisites are available.
4. Close J22 with the actual coordinated packages. Build/deploy/publication remains the established release workflow, not part of this documentation review.

## Source evidence inspected

- Installer roles, preflight and handoff: `apps/installer/src/main.rs`, `prerequisites.rs`, `journey.rs`, `extension_setup.rs`.
- Sharing/delegation: `apps/server/admin/joining-kit.js`, `apps/public-intake/cloudflare/client-downloads.mjs`, `customer-website/join.html`, `join.mjs`.
- Desktop/web joining: `apps/desktop/src/app.tsx`, `src-tauri/src/main.rs`, `apps/web/src/app.tsx`, `mvp-client.mjs`.
- Extension: `apps/extension/src/popup.mjs`, `popup.html`, `scripts/release/extension-review.mjs`.
- Trust/errors/operations: `apps/server/src/connection-readiness.mjs`, `packages/domain/src/connection-help.mjs`, `deploy/maintenance.mjs`, `apps/server/src/admin/backup-status.mjs`.
- Prior goals and acceptance: [operations plan](self-hosted-operations-plan.md), [local Admin](server-admin.md), [installer](../release/installer.md), [operator runbook](../release/server-test-install.md).

### Progress: optional Windows browser trust (2026-11-12)

J08/J17 now have an opt-in installer implementation: verified public CA → separate default-declined confirmation → Current User trusted roots, with no `--yes` approval, machine-wide import or browser-policy bypass. The public guide now explains per-computer setup, online versus offline readiness, success checks, manual alternatives and removal. Linux remains guided manual import. The J08/J17 acceptance checkboxes remain open pending packaged clean-host/browser testing; the developer’s real root store was not changed by implementation tests.

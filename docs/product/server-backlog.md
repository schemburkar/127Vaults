# Server backlog

Updated 2026-10-13. The server is an **experimental internal MVP backend**. A local test bundle, backup/restore and migration rehearsals now exist; see [S1 evidence](../release/server-wave-s1-evidence.md). The container has one runtime entry point and the bundle has one operator command. The schema-7 extracted bundle passed guarded combined restore into a fresh project, overwrite refusal and existing-owner authentication/read. It is not ready for a supported real-credential first release or public beta.

| ID | State | Priority | Outcome and acceptance |
| --- | --- | --- | --- |
| SRV-001 | Done | Baseline | Private HTTPS/Host/Origin boundary, PostgreSQL schema checks, owner/invite onboarding, OPAQUE sessions, device enrollment/lifecycle, encrypted private-vault routes and signed operation/checkpoint routes are mounted. Source: `apps/server/src/main.mjs`. |
| SRV-002 | Partial | P1 | Populated schema 1→7, encrypted pre-backup, dry runs, lock contention and unknown-checksum refusal pass against the schema-7 release image. Current-schema encrypted backup and guarded combined restore pass. Authenticated rollback and unrelated-host procedure remain open. See [internal evidence](../release/internal-release-readiness-2026-10-13.md). |
| SRV-003 | Partial; guarded restore verified | P1 | Database and installation identity, including local operator credentials, restore into a new empty project; the pre-backup owner authenticates and reads encrypted items afterward. A second restore is refused. Off-host custody, scheduling and unrelated-host acceptance remain open. See [internal evidence](../release/internal-release-readiness-2026-10-13.md). |
| SRV-004 | Partial | P0/P1 | Unit tests and live owner encrypted-item/idempotency/race flow pass. Finish live device rotation/revocation, multi-device forks, rate limits and cross-account matrix. |
| SRV-005 | Partial | P1 | Podman image is non-root/read-only with private PostgreSQL, loopback HTTPS and persistent volume; stop/start passed. Verify Docker, clean unrelated host, private LAN, safe shutdown under load and upgrade. |
| SRV-006 | Partial | P1 | Bounded request telemetry, authenticated readiness metrics, CA-preserving certificate renewal, PostgreSQL outage/reconnect and hostile-input log inspection passed. Finish incident operation on a second host. |
| SRV-007 | Open | P1 | Freeze crypto/protocol formats, compatibility rules and deterministic vectors; obtain independent review for real-secret use. |
| SRV-008 | Partial | P1 | Production pnpm audit found no known vulnerabilities; `rustls` advisory fixed in `Cargo.lock`. A focused scan found development secrets in tracked `.env` from the initial local snapshot. Rotate/sanitize before publication; finish seven Rust warning triage, image digest pinning, full secret/history scan, signing, legal terms and public release gate. |
| SRV-009 | Open | P1 | Prove optional external SMTP-over-TLS egress and invited-user activation on the test bundle; keep password in a mounted secret file and PostgreSQL off the egress network. |
| SRV-010 | Open | P1 | Run bundle on an unrelated Podman and Docker host, including CA trust, browser owner ceremony, LAN firewall, backup/restore and client reconnect. |
| SRV-011 | Partial | P1 | [Pilot gate](../release/selected-real-data-pilot.md) is defined. Accept it only after intended-host browser/restore/device tests, independent crypto/application review, controlled data selection and a rotation/deletion plan. |
| SRV-012 | Partial; installer preflight implemented | P2 | Recipient doctor now reports redacted bundle/runtime/identity/engine/Compose checks with bounded external probes and actionable next steps, including JSON handoff. Setup/start validate options and refuse incomplete or conflicting existing identity state; automated failure, timeout, preservation and standalone-launch tests pass. Make client evaluation self-service only after CA trust, signed artifact verification, backup/key setup and safe upgrade/rollback can be guided and tested without a developer present. Current bundle is operator-led; target-host installer acceptance remains open. |
| SRV-013 | Partial; P0 smoke passed | P0/P1 | One container runtime entry dispatches serve/provision/schema/healthcheck; one operator executable imports install, backup, TLS and envelope modules. The envelope tests pass through that entry. The rebuilt-bundle, fresh init, verified private HTTPS, status and stop smoke passed on the existing Windows/Podman host ([evidence](../release/server-bundle-smoke-2026-10-06.md)). Clean-host and guarded restore acceptance remain open. |
| SRV-014 | Partial | P2 | Schema 4 permits several private vault rows per account. Schema 5 stores a versioned opaque client-encrypted settings envelope with CAS; clients reconcile divergent versions by explicit choice. Add signed reconciliation and two-device verification; the server must not learn names or collection labels. Remove the five-vault format cap through a reviewed format migration. |
| SRV-015 | Partial | P2 | Schema 6 and an authenticated removal endpoint require one explicit archive or move choice and a new encrypted settings revision in the same transaction. Archive retains encrypted items and can be restored. Move retirement requires exact source-item coverage by existing destination ciphertext and signed create history, current catalogue revisions and settled checkpoints; the source remains recoverable. The endpoint is idempotent and blocks later writes to retired vaults. Disposable PostgreSQL archive, restore, move, retry, incomplete mapping, and stale settings tests passed. CLI and desktop now prepare moves, reject unsettled local state, expose durable resume, and restore archived vaults. Finish live two-device interruption and desktop walkthrough tests. The server cannot inspect plaintext or detect a client's unsynced local edits. |
| SRV-016 | Implemented internal write slice; acceptance partial | P1 internal | Loopback local operator console supports audited invitation create/revoke, account suspension/reactivation/unlock, device revocation, admin roles and recipient-accepted ownership. Schema 7 preserves an active owner under concurrent demotion. Fresh operator password, Origin, CSRF and exact replay receipts are enforced. Production PostgreSQL/HTTP, Edge management and packaged HTTPS writes pass. File-configured operators remain distinct from account roles. Settings secrets, restore and SMTP resend remain operator workflows; clean-host/human acceptance remains open. See [contract](../architecture/internal-admin-management.md) and [evidence](../release/internal-release-readiness-2026-10-13.md). |
| SRV-017 | Partial | P1 | Signed license caps count active users and live invitation reservations under a transaction lock. Invitation creation and redemption reject capacity violations. The operator status command and authenticated license API show active, reserved and available seats and guide installation of a higher-cap license. Suspension/reactivation seat accounting now passes schema-7 PostgreSQL checks. Finish live concurrent invitation acceptance, upgraded-license rehearsal and rollback policy. Never delete or alter encrypted vault data when a limit is reached or a license changes. |
| SRV-018 | Partial | P1 | Signed installation-bound licenses and revocations can be installed locally. `GET /api/v1/license` reports active, grace, locked, revoked and clock state. Seat reservations and vault writes are gated; reads, sign-in and recovery remain available. A persistent high-water clock checkpoint detects backward steps over two minutes. Complete durable server-side license-sequence rollback protection, trusted-time/restore policy, bounded emergency export and full lock semantics before production enforcement. Cover renewal, key rotation, offline clients and restore without touching encrypted data. Coordinate with [commercial flow](../architecture/public-access-and-licensing.md). |
| SRV-019 | Internal owner/invite path; runtime closed | P0 for Cloud | Implement [shared Cloud tenancy](../architecture/regional-cloud-tenancy.md) end to end. The internal-only overlay creates a tenant catalog with a separate, unlicensed control owner identity, reservation/preparation/bootstrap lifecycle, tenant-scoped rate limiter and PostgreSQL RLS. Separate prepared and active request boundaries mount first vault-user registration, invitations, auth, device, sync, vault and settings handlers. Disposable PostgreSQL verifies four tenants, owner and invited-user enrollment, role restrictions, context reset and cross-host HTTP rejection. Cloud startup remains closed. Complete verified public control-owner linkage and authorization, production OPAQUE/SMTP acceptance, billing entitlement and seat enforcement, public ingress, exhaustive handler tests, client enrollment, tenant-selective restore, deletion, and operational launch evidence before enabling Cloud mode. |
| SRV-020 | Open; user-selected | Post-MVP priority | Reinforce the API-first server boundary so web/PWA, desktop and CLI consume the same versioned application contract. Keep business rules and authorization in the API, document compatibility, isolate client transport and bind local state to server/account identity. Retain the bundled same-origin web client. A centrally hosted PWA and cross-origin browser access are deferred, not part of this implementation or the MVP gate. See acceptance below. |

Server readiness has three distinct levels: **internal MVP backend** means the narrow fictitious-data flow works; **first release** requires a supported installation and restore path; **public beta for real secrets** additionally requires the security and legal gates. Only the first level is evidenced today.

The user's deferred manual run still covers SRV-005/009/010. The combined restore part of SRV-003/013 passed locally on 2026-10-12. Recipient preflight implementation and local checks are recorded in [installer evidence](../release/installer-preflight-evidence-2026-10-09.md). An independent crypto/application review and real-secret approval cannot be closed by local implementation alone. No real-world test credentials have been accepted into this checkout.

## SRV-021 — Private Tailscale connectivity

**State:** Two-computer native discovery/HTTPS/enrollment/sync/offline recovery passes; final public-download verification in progress. Browser CA ceremony and reboot/clean-host gates remain open. **Priority:** Do next; user-selected 2026-10-17.

Support an explicitly selected Tailscale IPv4 endpoint in the shared address range (`100.64.0.0/10`), including Sunrise's `100.99.146.58`. Review installer, server and client validation together; accepting the address in only one layer is insufficient. Keep loopback as the default, bind only to the selected interface, preserve exact HTTPS certificate/installation identity and Host/Origin checks, and document tailnet access controls and host firewall requirements. This does not authorize public Internet exposure or wildcard binding.

The user's subsequent direction prefers a loopback origin behind a private connector. The prepared mode discovers the endpoint through native Tailscale, retains host-loopback publication, and forwards TLS through Serve. Desktop/CLI peer discovery avoids manual tailnet IP entry. Public Funnel is refused. [Decision and Cloudflare/intranet alternatives](../architecture/private-connectivity.md). Do not mark accepted before the published two-host run.

2026-10-18: the published server0.0.2 setup created a distinct controller installation, then its guarded0.0.3 update preserved identity/users/license. Sunrise CLI and desktop discovered the host by name, pinned the CA, enrolled through owner approval, read the encrypted test item and recovered queued edits after service disconnect. Wrong CA fingerprint, Host, Origin and direct LAN probes fail closed; unrelated Serve443 remains unchanged. Desktop0.0.3/CLI0.0.2 were tested internally before a single combined publication. Full final consumer-download provenance and the original Sunrise server update are being recorded in the [current checkpoint](../release/sunrise-upgrade-plan-2026-10-17.md). Browser owner tests used an isolated certificate-ignore context after Windows refused noninteractive root import; they do not close interactive CA trust. Native CLI/Node HTTPS verification used the actual pinned CA.

**Acceptance:** Using published packages, host on one tailnet computer and complete server trust, account/device enrollment, approval, sync and offline-client recovery on another. Verify that unapproved hosts/origins and unintended network interfaces remain inaccessible. Document the supported private-network path and distinguish it from a single-machine loopback setup.

## SRV-020 — API-first server boundary (post-MVP priority)

**Decision:** Prioritize after MVP acceptance. Preserve the option of a future
client at `vault.127vaults.com` without implementing or deploying that hosted
client now. This work does not enable the hosted Cloud server offering.

**Acceptance:**

- Review web/PWA, desktop and CLI workflows for UI-specific server behavior or
  business rules outside the API. Put authoritative validation, authorization and
  business rules behind the shared versioned API; clients retain presentation,
  local cryptography and offline behavior.
- Document the existing `/api/v1` contract, authentication and error semantics,
  protocol/version compatibility and upgrade behavior. Verify representative
  workflows through the contract across the supported clients.
- Keep the bundled web interface as an API consumer. Centralize its request
  transport and identify same-origin assumptions so a selectable API endpoint can
  be added later without rewriting application workflows.
- Make installation identity and account identity explicit in local state and
  queued work. Prevent cross-installation/account state reuse or transmission;
  do not silently rebind an enrolled profile to another server.
- Preserve current HTTPS, Host, Origin, CSRF and authentication boundaries, with
  regression checks. Do not enable wildcard CORS, loosen cookie policy or add
  remote browser origins as part of this item.

**Deferred separately:** Hosted-PWA deployment, cross-origin authentication/CORS,
browser LAN/VPN connectivity, certificate onboarding, shared-origin storage
isolation and centrally delivered client-update trust require their own design
and security acceptance before remote browser access is enabled.

## Localhost server administration page — remaining backlog

**Goal:** A browser control panel for the person operating a local server: inspect health, manage users, and handle routine settings. It does not display vault contents. Inspection and the selected internal management-write slice are implemented and tested. Broader settings, SMTP resend, diagnostics export and clean-host acceptance below remain open.

**Access:** The current console is loopback-deployment-only and uses separate file-configured local operator credentials, sessions and CSRF-protected sign-out. Private-LAN access needs a separate decision and the existing HTTPS, Host and Origin protections. Account-management writes enforce a reviewed authenticated owner/admin model, CSRF checks and server-side authorization for every action. Sensitive changes need fresh authentication. Use the proposed [server role boundaries](../adr/0017-server-ownership-and-roles.md), with the exact internal permissions recorded in the management contract. Server roles do not grant vault keys. Preserve at least one active owner; owner grants require recipient acceptance.

| Priority | Area | Workflow and acceptance |
| --- | --- | --- | --- |
| P0 | Sign-in and navigation | Show server identity, current role, session expiry and sign-out. Handle expired sessions and server outages clearly. |
| P0 | Overview | Show API/database readiness, server and schema versions, backup freshness and actionable warnings. Show check time and distinguish unknown from healthy. Exclude secrets and vault data. |
| P0 | Users and invitations | Search and paginate accounts with role, status and relevant timestamps. Invite users, resend/revoke pending invitations, suspend/restore accounts, and show device counts. Confirm disruptive actions and explain their session impact. |
| P0 | Roles and ownership | Owner can grant/revoke admin and initiate owner transfer. Block removal of the last owner and require the receiving user to accept ownership after fresh authentication. |
| P1 | Devices and sessions | Inspect device and last-seen metadata; revoke devices or invalidate sessions where policy permits. Explain propagation and recovery without exposing device secrets. |
| P1 | Operations | Show backup status and last restore drill; offer a guarded backup when supported. Keep restore, migration, shutdown and server deletion in separate runbooks for the first version. |
| P1 | Settings | Show redacted network, TLS, email, retention and limit settings. Validate edits, preview effects, log changes and never redisplay saved secrets. |
| P1 | Audit and diagnostics | Filter control-plane events by actor, target, time and outcome; include correlation IDs. Export redacted diagnostics without credentials, codes, tokens, vault metadata or ciphertext bodies. |
| P2 | Accessibility and deployment | Responsive keyboard-accessible page with loading, empty, error and permission-denied states. Document local URL and startup; verify in supported browsers and on a clean-host test bundle. |

**Implementation status:** Overview, directories and the selected invitation/account/device/role/ownership write slice are implemented with separate local operators. Audit displays the latest 100 metadata events. Remaining work is the release matrix, operations/settings scope and diagnostics export. Reuse existing sessions and onboarding where appropriate. Add new control-plane routes to the API contract and audit every attempted state change, including denied attempts.

**SRV-016 acceptance:** Owner and admin complete permitted workflows on a fresh localhost install. Normal users and unauthenticated browsers cannot read or change admin data. Automated checks cover authorization, CSRF, stale sessions, last-owner protection, redaction and audit events. A manual browser walkthrough verifies visible states.

## Internal release acceptance — 2026-10-13

Windows and Linux, all client surfaces and admin writes are explicitly selected. See the [current evidence and remaining gates](../release/internal-release-readiness-2026-10-13.md). Implementation and narrower tests do not close wider acceptance rows. The candidate remains fictitious-data-only.

## SRV-022 — Reduce server image and download size

**State:** Open. **Priority:** P1 supported release; user-requested 2026-10-18.

The published server 0.0.3 archive is 1,227,176,960 bytes (about 1.23 GB). Measure the application and PostgreSQL image sizes, individual layers, bundled runtime/build dependencies and archive overhead before choosing reductions. Evaluate compressed distribution, smaller production-only images, duplicate-layer removal and excluding unnecessary build assets while retaining the offline installation option. Do not assume the whole bundle size is the application image size.

Acceptance: record before/after archive, image and extracted sizes; document the chosen tradeoffs; verify hashes and archive handling in the published download/installer flow; prove fresh installation and an existing-installation upgrade with vault data, identity, CA and license preserved. Keep candidate builds internal until checks pass, then publish one combined release. No implementation or republishing is authorized by this backlog-only request.

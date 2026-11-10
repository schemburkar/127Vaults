# Self-hosted setup and operations plan

A household or small team should be able to install the server, enroll its first owner, invite people, and maintain and recover the installation without copying commands from a runbook. The installer takes the operator to the local `/admin` console. The console is the starting point for routine server work and points to the installer’s recovery mode when the server cannot complete a task itself.

This is a local product plan. The Manage portal remains the place to obtain downloads and manage subscriptions. Central Admin remains the platform operator’s portal.

## Implementation checkpoint

- The invitation page leads with the standalone downloads and a copy button for the private URL. The installer accepts the URL in a hidden prompt. Manual package and license steps are available under a separate disclosure.
- Interactive server installation can create the first local operator for a loopback deployment, show the server address and public CA file, and generate the first-owner setup link. The installer uses the existing operator initialization and bootstrap commands. Older vault packages can use the displayed one-time code.
- Local Admin shows the household setup sequence and produces a private setup link for each invitation. The interactive installer can configure initial enrollment email using the customer's SMTP-over-TLS provider. It keeps the password in the private runtime directory and restores the prior settings if the server fails to start. It sends no probe email. SMTP rotation, delivery diagnostics and a host-local Admin entry for private-network deployments are still open. A loopback invitation works only on the host.
- **P2 · Desktop server license information.** For a connected self-hosted profile, show read-only license state, plan, expiry and read-only grace in Desktop Settings with a link to the appropriate management surface. Distinguish live status from offline or unavailable status. Never expose license material, subscription credentials or operator controls to a vault session.
- The clean-host download-to-owner test, lost-operator recovery, storage and backup controls, printable recovery record, and server-down recovery remain rollout gates.
- An invitation bound to a lost installation identity still requires approval for a replacement license. Plan a verified customer recovery flow in Manage with explicit retirement of the prior installation, audit and abuse controls, and a clear distinction between license replacement and recovery of encrypted data. Trial expiry and replacement eligibility remain governed by their existing policy.

## Inventory and proposed workflows

| Today’s manual work | Proposed workflow | Phase |
| --- | --- | --- |
| Download and run the installer, choose components and storage, select an engine or Compose provider, resolve missing prerequisites, and confirm license and startup. The bundle also exposes `install init`, `start`, `status` and doctor checks. | Guide fresh installs and existing-install detection. Show the selected disk, paths, free space, engine readiness, license and start result. Surface any OS permission prompt in context. Open the local setup page after a health check. | 1 |
| Create the operator file with `admin init`, set a password in the shell, and restart. Additional operator changes use the file. | Set up the first operator through a short-lived local installer handoff. Let authorized owners add, rotate, change roles and revoke operators. Revoke affected operator sessions on changes and preserve the last operator owner. Provide host-local recovery for a lost operator password. | 1 |
| Run `install bootstrap`, carry the setup capability to the browser, then create the first vault owner. | Show an owner enrollment step in the setup checklist and offer an authorized one-time link. Keep operator identity separate from vault identity. The recipient creates their own vault password and accepts ownership in the vault. | 1 |
| Invite family members or users, distribute or resend invitations, troubleshoot verification email, approve new devices, and deal with locked accounts. | Build on the existing Users, Invitations, Roles and Devices sections. Add a first-family checklist, pending invitation follow-up, delivery status and rate-limited resend when configured, and clear device enrollment instructions. The trusted vault user approves a new device in their vault. Add scoped session invalidation and explain its effects. | 2 |
| Set enrollment SMTP parameters and restart or inspect server logs when delivery fails. | Provide redacted email settings, validation, a connection check without sending mail, and delivery diagnostics. Store credentials with restricted permissions. Keep user-facing invitation delivery explicit and audit administrative changes. | 2 |
| Run `install identify`, apply a signed license or revocation file, or configure subscription refresh. | Show a copyable installation ID, license and seat state, and a link to Manage. Accept signed license material through a guided local workflow with binding, signature and sequence checks. Explain expired or revoked states and retain access supported by policy. | 2 |
| Select `--endpoint`, `--hostname` or `--tailscale`. Configure DNS, firewall or tailnet access. Carry the private CA to clients and run `tls renew` when needed. | Preview local, private LAN and Tailscale settings and run reachability checks. Show the client URL, installation ID, CA fingerprint and per-device trust steps. Offer supported certificate renewal and a separate existing-origin migration workflow with verification and recovery. OS trust, router and tailnet controls remain explicit handoffs with a return check. | 3 |
| Inspect engine volumes and disk space, choose paths manually, relocate data, or check whether the installation returned after reboot. | Show identity, database and backup locations, free space, and health. Offer supported disk relocation with a verified backup, destination checks, a staged copy and rollback. Keep service start, stop and restart available from the host when the web console is unavailable. | 4 |
| Select a backup destination and key, run `database backup` and `database rehearse`, back up identity separately, and keep track of dates and files. | Set backup destination, schedule and retention locally. Run backup and isolated restore verification on demand, show the last success and failure, and explain whether both database and identity are recoverable. Verify a new backup before pruning earlier copies. | 4 |
| Apply upgrades with backup options, restore identity and database, or recover from a failed upgrade. | Show an upgrade preflight and hand off to the verified installer. Offer a recovery mode that runs with the server stopped or missing. Verify backup integrity and installation binding before restore, stage into a separate destination, and confirm identity, owner sign-in and sync before switching over. Keep uninstall and erase separate from stopping or upgrading. | 5 |
| Save install output, inspect logs, and remember what changed. | Show durable operation status and a redacted support export. Include check time, version, operation result and a reference ID. Exclude credentials, invite capabilities and vault data. Offer a printable local recovery record. | 1–5 |

## What the operator should keep

Generate a local installation and recovery record after setup and refresh it after network, storage, or backup changes. Include the operator and client URLs, installation ID, CA fingerprint, server version, install/data/backup locations, and the date of the last verified restore. Explain how to open recovery mode and how to find the separately stored recovery material. Allow the operator to omit paths when sharing diagnostics.

The recovery record must exclude operator or vault passwords, setup links, session cookies, private keys and backup decryption keys. During onboarding, guide the operator to store backup recovery material separately from the server and its backup archives. Verify that the material works during an isolated restore rehearsal.

## Local control and rollout gates

- **Phase 1 · Install and open Admin.** Exercise the packaged installer on fresh supported Windows and Linux hosts with no development tools. Cover prerequisite failure, reboot, repeat install, first operator setup, first vault owner enrollment and host-local operator recovery.
- **Phase 2 · Run a household.** Enroll a second user, verify a new device through a trusted device, handle expired and revoked invitations, recover a locked sign-in, and verify role and seat rules. Use captured mail in tests. Check that existing installs can adopt the setup flow without replacing identity or credentials.
- **Phase 3 · Connect privately.** Today `/admin` is enabled only for loopback deployments. Design and verify an independent host-local management entry before enabling these workflows on LAN or tailnet installations. Keep Admin reachable on the host when a network edit fails. Verify peer connectivity, certificate trust, wrong-identity rejection and that the vault listener does not serve Admin to peers. Keep public exposure outside this plan.
- **Phase 4 · Protect the disk.** Test full or missing disks, invalid permissions, interrupted operations, retries, insufficient backup coverage and recovery after reboot. Reuse the operator scripts and keep receipts. Run real encrypted backup and isolated restore against disposable installations.
- **Phase 5 · Recover and upgrade.** Test clean upgrade, failed upgrade, data relocation, server-down restore and recovery on a replacement host. Verify retained installation identity, license, accounts and client sync with packaged clients before accepting the workflow.

Implement privileged operations through the existing installer and operator commands. If the console needs host help, design a narrowly scoped local interface with explicit operation types, validated paths and no generic shell or container-engine access from the web process. Require fresh authentication for sensitive actions, preview destructive effects, serialize conflicting operations, and audit outcomes. Keep a documented command-line path for recovery and unattended operators.

## Runbooks reviewed

- [Standalone installer](../release/installer.md)
- [Server test bundle and operator commands](../release/server-test-install.md)
- [Local Admin guide](server-admin.md)
- [Private connectivity](../architecture/private-connectivity.md)
- [Server backlog and release acceptance](server-backlog.md)

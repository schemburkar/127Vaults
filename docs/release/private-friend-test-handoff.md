# Private friend test handoff

Status: technical, supervised testing with fictitious vault data only. This is not a supported release or a real-secret invitation. See [beta readiness](beta-readiness.md) and the [server install runbook](server-test-install.md).

## What can be handed over now

| Component | Current handoff | Current limit |
| --- | --- | --- |
| Self-hosted server and web app | `node server.mjs bundle <new-output-directory>` produces OCI image archives, Compose configuration, the operator command, and a hash manifest. Transfer the directory as a ZIP or private file handoff after verifying its contents. | A technical operator needs Node 24, Podman/Compose, private CA setup, firewall and backup-key custody. No one-click installer or supported real-data release. |
| PostgreSQL | Image archive accompanies the server bundle; persistent data stays on the recipient's named volume. | Database and installation identity require separate encrypted backups. |
| Desktop and CLI | Buildable from this source for the intended OS; use the exact client and server revision together. | No signed, versioned public installer/update catalogue yet. A raw binary is a test artifact, not a complete installation package. |
| Chrome/Edge extension | Load `apps/extension` unpacked in Developer mode. For desktop/CLI sources, build and register its native host separately. | No signed store package or automatic update path. |
| Cloud | No handoff. Cloud mode is internal and disabled in the customer server image. | No public Cloud listener, checkout, restore, or tenant deletion workflow. |

The web client is included in the server image. The ZIP is a transport wrapper around the test bundle, not a different server installation method. A private image registry could carry OCI images later, but the current operator flow uses archives and a manifest; pushing only the server image would omit PostgreSQL, Compose configuration, operator scripts, and identity setup.

## Recommended one-to-one fictitious-data test

1. Record the tested commit, build tool versions, OS, container engine, and artifact hashes. Build a fresh server bundle outside the checkout. Do not include the development `.env`, test database, private CA key, bootstrap code, runtime keys, or local encrypted replicas in the handoff.
2. Transfer the bundle through a private channel. The recipient verifies `manifest.json`, installs the stack with the [server install runbook](server-test-install.md), and confirms the CA fingerprint directly with the sender before trusting the server certificate.
3. Provide the matching experimental desktop/CLI build and unpacked extension source only for the platforms under test. Give a short walkthrough with fictitious credentials and a known test login item.
4. Exercise owner signup, login, one encrypted item, desktop/CLI sync, extension fill, server stop and offline read, restart, backup, and a restore rehearsal. Record failures and exact versions. Wipe test profiles only after evidence and any needed encrypted backups are preserved.

Do not treat missing license enforcement as permission to distribute without terms. The [release licensing decision](../adr/0013-release-licensing.md) requires reviewed release-specific terms and express authorization for private testing. Before sending a package outside the development team, settle the intended test license and recipient agreement. Real credentials require the separate [selected real-data pilot gate](selected-real-data-pilot.md) and independent security review.


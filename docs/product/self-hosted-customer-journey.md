# Self-hosted customer journey

Status: implementation audit, 2026-10-07. This describes the intended Personal and Commercial path. The public release, billing, and production license path are not open yet. Cloud has a separate lifecycle.

| Stage | Customer action and expected result | Current implementation | Gap before public launch |
| --- | --- | --- | --- |
| Discover | Compare Personal and Commercial terms, deployment duties, and supported platforms. | Pricing, deployment, FAQ, and availability pages exist. | Legal review of terms and release-specific BSL parameters. |
| Request access | Choose a self-hosted plan and submit contact email and consent. Receive an honest receipt; no account or purchase is implied. | Same-origin waitlist form and encrypted experimental intake exist. Static preview leaves submission disabled. | Production abuse controls, privacy/retention and deletion process, key recovery, monitored follow-up. |
| Qualify and order | Receive a plan quote, confirm billing identity, commitment, seat needs and terms; complete hosted checkout. | Product rules are documented. | Public customer account, server-side order catalogue, checkout, verified payment webhooks, reconciliation and invoices. A browser return must not create entitlement. |
| Obtain release | Download an approved signed bundle and clients; verify signature, hash, version compatibility and release license text. | Empty validated release catalogue; operator test bundle has a SHA-256 manifest. | Signed immutable public artifacts, trusted signing key distribution, platform matrix and release approval. Current test bundle is not a public installer. |
| Install server | Operator provides private IPv4 or loopback endpoint, container engine, Node 24, storage, private CA trust and backup locations. Run init/start/status. | Test bundle installer creates identity and starts server/database. | Supported clean-host matrix, remote-access design, update/rollback and recovery sign-off. |
| Bind entitlement | Read installation ID locally, send it through the customer portal, download the signed license, install it locally. | `node server.mjs install identify` reports the running test installation ID. Server can verify a license and show authenticated status when files are configured. | Portal, issuer, authenticated local replacement, persistent sequence anti-rollback, cap/expiry enforcement and recovery policy. Never ask for vault secrets or upload a license to the public site. |
| Create vault owner | Retrieve one-time setup code locally, enroll owner in the served HTTPS web client, save account secret and device recovery material. | `install bootstrap` and owner enrollment exist. | Human acceptance on supported hosts and user-facing recovery guidance. Public account identity is separate from vault owner identity. |
| Add users and devices | Owner invites by email, recipients verify and enroll, each device establishes its own identity; install separate clients where approved. | Invitation and client flows exist in the experimental server. | SMTP provider and egress verification, production client distribution and cross-device acceptance. The default test install supports the owner only. |
| Operate and renew | Monitor status, back up database and server identity separately, rehearse restore, renew entitlement and update safely. | Backup/rehearsal commands and experimental license status exist. | Automated and tested renewal, enforcement policy, emergency export, support and production operations. |

## Available supervised test sequence

Use fictitious data and an unpublished bundle. Build and transfer the bundle as described in [server test installation](../release/server-test-install.md). In the extracted bundle:

```text
node server.mjs install init --endpoint 127.0.0.1
node server.mjs install start
node server.mjs install status
node server.mjs install identify
node server.mjs install bootstrap
```

Verify the local CA fingerprint and trust its certificate before opening the HTTPS web client. Complete owner registration there. Configure SMTP before inviting others. Set up independent encrypted database and identity backups and rehearse restoration before retaining data. The installation ID is a public binding identifier; the bootstrap code is a secret and must stay on the operator channel.

## Launch gate

The waitlist is the only public entry point currently designed. No customer can complete the paid self-hosted pipeline today. Do not activate checkout, publish a download, or claim that a waitlist receipt creates an account until the matching release and entitlement lifecycle has passed the gates above. Keep experimental status distinct from production license enforcement.

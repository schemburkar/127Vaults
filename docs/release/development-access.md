# Development access through the standard invitation flow

Cloudflare operator approval supports development access separately from unpaid
10-day trials. It uses the normal invitation authentication, catalogue entitlements,
activation endpoint and signed license format. Public requesters cannot select or
approve development access. This capability requires deploying the updated Worker
and private operator page; source implementation is not live publication.

For a directly issued development license, submit the usual access request and
use its operator Actions menu to attach the existing signed development license.
The service verifies its issuer and signature, plan, installation identity, expiry
and limits. The signed bytes and binding remain unchanged. The resulting private
invitation belongs to that installation, rather than borrowing another server's
invitation. No replacement or trial activation is necessary.
When the invitation matches an already active licensed server, the installer keeps
that license automatically instead of reinstalling its signed sequence on each
update. Explicit cross-installation download-only mode remains separate.

For a new development installation, the operator explicitly chooses a finite
expiry (up to ten years) and seat limit. Normal activation signs a development
license with that approved expiry, never a hidden date override or infinite date.
Link rotation and package updates preserve the development entitlement. An expired,
wrong-issuer or malformed attached license is refused. Approval itself is limited
to a pending request, with the usual authenticated operator and Origin protections.

Development operator contact records are retained while that explicitly approved
development entitlement is active; normal unpaid-request retention remains 90 days.
Closing access removes that exception. Invitations retain their normal 30-day
availability and can be rotated without changing the installed license.

The recurring operator command for an existing signed license is:

```powershell
node scripts/ops/development-access.mjs --config .cloudflare-deploy/config.json --request-id <request-id> --license-file <signed-development-license.json> --output <new-private-invitation.json>
```

The command uses the configured operator credential, saves the invitation privately
and does not send email. Never submit the issuer private key or a backup key.
For the same operator-approved requester on a different development installation,
replace `--request-id` with `--source-request-id <existing-request-id>`. The script
uses that requester's existing contact in the normal request endpoint, approves only
the newly created request and leaves the original installation's invitation alone.
If matching development access already exists, it reuses it instead of creating a
duplicate. Normal intake notifications may run; no invitation email is sent.
Do not bypass the service by editing D1 records or changing signed license dates.

For a development server locked after an accidental clock change, first verify
Windows, the container and an independent UTC reference agree. A normal restart
preserves the clock checkpoint and cannot repair a checkpoint ahead of real time.
Use `scripts/ops/recover-development-clock.mjs --container <name> --identity
<absolute-identity-directory> --receipt <new-private-directory> --reference-time
<verified-UTC-ISO-time>` for a confirmed rollback under one day. The command
requires an active signed development license, verifies the container's identity
mounts and clocks, stops only that server, backs up the original checkpoint,
updates its clock observation and restarts it. It preserves the signed license
and encrypted data. Keep the receipt and verify `/api/v1/setup` returns
`licenseMode: active` and `licenseClockState: trusted` before retrying unlock.

# Customer transactional email

Resend supports the public website's customer account messages. It is separate
from the self-hosted vault server's SMTP and generic notification relay design.
No vault password, Secret Key, decrypted item or vault content is sent to Resend.
Resend necessarily receives recipients, account-message contents, sign-in codes
and private invitation links when used for delivery. The access form discloses
this boundary. Message bodies and provider error bodies are not logged.

## Current activation state

The Resend account is connected. On 2026-11-05, `127vaults.com` was registered
for sending in `us-east-1`, with receiving, open tracking and click tracking
disabled. The four provider-requested DNS records were installed using the
separate `cf` CLI profile and read back successfully. A second run confirmed
idempotency. Resend authentication verification has been started; the
restricted sending key has not been provisioned. Automatic delivery remains
disabled; operator-copyable customer messages remain available. No real test
email has been sent.

The user explicitly authorized one setup verification email. This exception
does not permit real sends from automated tests or routine deployment checks.

The proposed sender is `127Vaults <accounts@127vaults.com>`. On 2026-11-05,
[Resend pricing](https://resend.com/pricing) lists 3,000 transactional emails per
month, a 100/day cap and three domains on Free. This deployment defaults to a
90/day and 2,800/calendar-month ceiling, with the final 20 daily slots reserved
for sign-in codes. Other applications using the same Resend account consume its
quota too. This integration does not enable a paid plan or pay-as-you-go.

## Messages

- A receipt for a newly submitted public access request. It explicitly does not
  approve access, start a trial or create a subscription.
- Customer sign-in codes, with the existing ten-minute expiry and one-use checks.
- Approved, rotated and updated customer invitations.
- Trial/license extensions and approved installation replacements, through their
  existing invitation messages, preserving the underlying entitlement rules.
- Access-request closure or rejection notices.

Approvals and license changes remain separate authorized Admin actions. Normal
customer invitations send automatically after those actions when Resend is
enabled. The existing explicit Send invitation action uses the same durable
receipt and cannot send a second copy of an automatically sent message.
There are no marketing campaigns, periodic test sends, historical backfills or
new billing-provider email flows. Existing fixed-recipient operator alerts keep
their existing Cloudflare binding and do not consume Resend quota.

## Internal testing never uses Resend

- Local site configuration forces capture mode and disallows external network.
  It never imports production Resend credentials.
- Production mode, a valid sending key and an admin/customer Worker role are
  all required. Merely retaining a secret on a disabled Worker cannot send mail.
- Development-license notifications are suppressed. Development-only portal
  identities use the encrypted manual-code inbox even when customer delivery is
  enabled. Reserved example/test/local domains and `resend.dev` are rejected.
- Automated tests use injected in-memory HTTP responses or Miniflare's mocked
  outbound service. They do not use Resend's real test-email endpoints.
- Use local capture or operator-copyable invitations for internal acceptance.
  Do not submit synthetic requests or request sign-in emails on the production
  customer site as part of smoke tests after activation.
- Do not run routine send probes to check a key, sender or domain. Activation readiness
  checks validate configuration and secrets without contacting Resend. Resend
  delivery acceptance remains unverified until a genuine customer action occurs.

## Activate later

DNS operations can use the separate `cf` CLI login, whose permissions differ
from Wrangler's OAuth login. Use `scripts/cloudflare/configure-email-dns.ps1`
with `-Zone`, a provider-record JSON array supplied through `-RecordsFile`, and
`-ReceiptFile`. It adds missing TXT/MX/CNAME records, refuses conflicting values,
preserves unrelated DNS, and verifies the resulting records. Resend setup
receipts are retained under `.tools/site-checks/resend-dns-*-receipt.json`.

1. Create the Resend account on the intended Free plan. Add and verify
   `127vaults.com` following Resend's displayed DNS records. Retain existing
   mail/DNS configuration; do not replace root MX records to onboard a sender.
   Disable open/link tracking for these account messages in the domain settings.
   Provide an inbox or forwarding route for replies to `accounts@127vaults.com`.
2. Create a sending-only API key restricted to that domain. Save it as
   `.cloudflare-deploy/secrets/resend-api-key`, without sharing its value in chat,
   source, logs, workflows or public assets. Retain protected directory ACLs.
3. Prepare disabled configuration if desired:

   ```text
   node scripts/cloudflare/configure-resend.mjs prepare .cloudflare-deploy/config.json accounts@127vaults.com
   ```

4. After domain verification and the key are ready, explicitly enable:

   ```text
   node scripts/cloudflare/configure-resend.mjs enable .cloudflare-deploy/config.json
   ```

5. Commit/push intended source and dispatch the existing `Publish separated
   websites` GitHub workflow. It backs up D1, applies additive migration
   `0005_customer_email.sql`, and deploys the existing website targets. Installer
   packages, vault databases and licenses do not need rebuilding or reissuing.
6. Check authenticated `/api/access-admin/email-status`. It reports mode and
   configured ceilings without credentials or sending an email. Do not send
   synthetic signup, invitation or sign-in email for deployment verification.

To return to manual delivery, run the same command with `disable`, then redeploy.
Legacy Cloudflare customer-email configuration remains supported when no
`customerEmail` configuration is selected. Resend's explicit disabled setting
takes precedence over legacy flags and restores manual customer-code delivery.

## Persistence and failure behaviour

`customer_email_receipts` stores encrypted message bodies, purpose, request ID,
provider acknowledgement ID and submission state. Atomic inserts claim each
event once across Workers. Resend receives a stable per-event idempotency key;
its [provider deduplication window](https://resend.com/docs/dashboard/emails/idempotency-keys)
is 24 hours, while application receipts prevent subsequent attempts longer.

Queued means acknowledged by the API, not delivered to an inbox. Provider
rejection, quota exhaustion and uncertain network outcomes do not roll back
signups, approvals or licensing actions. An unconfirmed sign-in code is
invalidated; the customer can request another code later. General uncertain
notices are retained for operator review and are never automatically replayed.
An invitation remains available for manual copying if delivery is unavailable.

Sign-in email receipts expire after ten minutes and are removed by the next
hourly cleanup. Other encrypted receipts expire after 90 days. Explicit request
erasure removes its receipts immediately; retention cleanup also removes receipts
whose contact row has been erased. Budget counters use UTC calendar windows and
contain no recipient email address. No previously issued invitation or license
is changed by installing this migration or enabling delivery.

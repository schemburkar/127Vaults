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
idempotency. Resend reports the domain and all four records verified. The user
supplied the restricted sending key, and production delivery was enabled through
the separated-sites workflow on 2026-11-05 (run `42037095461`, source `c43d88c`).
The authenticated live status confirms Resend production mode and automatic
customer email enabled. Existing request, invitation and license records passed
the preservation check. Operator-copyable customer messages remain available.
No real test email has been sent; provider submission and inbox delivery will
first be exercised by genuine customer actions, not deployment probes.
The activation receipt is `.tools/site-checks/resend-activation.json`.

The user subsequently made live testing conditional on quota-free test emails.
Resend's official test-email documentation states that test recipients consume
sending quota, so no live setup or request-flow test will be sent. All validation
uses local capture or mocked provider responses.

The proposed sender is `127Vaults <accounts@127vaults.com>`. On 2026-11-05,
[Resend pricing](https://resend.com/pricing) lists 3,000 transactional emails per
month, a 100/day cap and three domains on Free. This deployment defaults to a
90/day and 2,800/calendar-month ceiling, with the final 20 daily slots reserved
for sign-in codes. Other applications using the same Resend account consume its
quota too. This integration does not enable a paid plan or pay-as-you-go.

## Public request protection

Production access requests require a chosen name for both Personal and Commercial
plans. No first/last-name format is imposed. Existing contacts are not rewritten.
The public form starts a fresh security challenge on submission, checks Turnstile,
and waits briefly before posting the request. The server independently enforces
the signed challenge's minimum age. Visitors must keep the page open until the
request is accepted; this is not a delayed email queue or automatic approval.
Customer receipt and normal operator alert dispatch starts only after acceptance.

The host-only browser cookie is Secure, HttpOnly and SameSite=Strict, expires after
one day and carries a signed random browser reference. A signed challenge binds
that cookie, a keyed IP reference, issue time and random nonce. Challenges expire,
are claimed once atomically, and a durable browser cooldown limits repeat sends.
Turnstile validation checks success, exact hostname, action and challenge binding;
provider outages fail closed. Existing IP/email limits and honeypot remain active.
Clearing cookies or rotating IPs can evade individual checks, so this is layered
abuse resistance rather than proof of identity or email ownership.

The operator receives a separate Cloudflare volume alert when distinct accepted
email addresses exceed the private rolling-window threshold. The threshold and
window are private deployment variables on Admin, absent from public assets and
API responses. The alert is claimed durably before sending and attempted at most
once per monitoring window, including ambiguous outcomes. Rejected attempts and
honeypot submissions do not count. The message prompts review without claiming
that high volume proves either popularity or abuse. It never approves access and
does not use Resend quota.

`0006_intake_protection.sql` adds ephemeral challenge/browser state, keyed email
activity and a single alert receipt. Scheduled cleanup prunes expired state; erased
requests also lose activity entries. No existing request/license data is changed.
The Turnstile secret is supplied only to Intake; Public, Admin and Manage do not
receive it. CSP permits Turnstile's script and iframe only on the public site.

Provision with `scripts/cloudflare/configure-intake-protection.ps1`, providing the
private threshold through `-VolumeThreshold` and optionally `-WindowHours`. The
script uses the separate `cf` CLI, reuses the named hostname-restricted widget,
and stores its secret only in the protected secrets directory. Publish through
the existing separated-sites workflow. Do not put actual thresholds in public
copy or browser scripts.

Validation uses `scripts/sites/intake-protection.test.mjs` (including the real
Intake Worker with a mocked Siteverify service) and
`scripts/sites/intake-form-check.mjs` (intercepted browser traffic). These checks
do not contact Turnstile or send Cloudflare/Resend mail. Browser screenshots and
receipts are retained under `.tools/site-checks/intake-form/`.

The website backup gate retains failed CLI diagnostics only in the private state
directory. D1 export's observed provider internal error is retried at most three
times with bounded waits; authentication/configuration failures stop immediately.
Deployment still requires a successful SQL export. No backup gate is skipped.

## Customer messages

- A receipt for a newly submitted public access request. It explicitly does not
  approve access, start a trial or create a subscription.
- Customer sign-in codes, with the existing ten-minute expiry and one-use checks.
- Approved, rotated and updated customer invitations.
- Trial/license extensions and approved installation replacements, through their
  existing invitation messages, preserving the underlying entitlement rules.
- Access-request closure or rejection notices.

The operator's existing Cloudflare new-request and replacement-request alerts
include the requester, organization, plan, requested users, timestamp and a
direct `/access-admin?request=…` link. The link contains only a request reference,
requires normal Admin authentication and never changes the request by opening it.
These operator alerts remain independent of Resend customer delivery.

The request desk displays whether automatic customer email is enabled and shows
receipt/invitation/access-notice submission states. Approval, decline, closure,
link replacement, package updates, extensions, replacement licenses and manual
send actions explain their email effect before execution. Every mutation uses a
confirmation dialog with requester identity and a required acknowledgment;
extensions also show the chosen days and approval shows the chosen user limit.
Cancel and Escape do not call the mutation API. Message previews remain
available as an optional manual fallback; operators must check submission status
before sending a copy themselves. Queued is not inbox delivery confirmation.

Browser verification: `node scripts/sites/request-review-check.mjs` (using
`VAULTS_PLAYWRIGHT_MODULE` / `VAULTS_BROWSER_EXECUTABLE` when required). It
intercepts all network traffic and retains screenshots and its receipt beneath
`.tools/site-checks/request-review/`.

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

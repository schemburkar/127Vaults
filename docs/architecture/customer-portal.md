# Customer portal

The customer site is the account-facing portal for requests, private invitations, downloads, licenses and subscription management. It is separate from both 127Vaults Admin and every vault account. Implemented locally on 2026-10-28; no deployment, account onboarding or real email/payment was performed.

## Customer journeys

1. A new customer submits Request access on the public website. Intake stores the request, and an operator reviews it in Admin. Customer sign-in never approves a request or creates a paid entitlement.
2. The customer can open the original private invitation or paste it into the portal's invitation form. A valid link creates a Secure, HttpOnly, host-only customer session limited to that one approved request. It does not prove ownership of all records with the same email. Rotating the invitation invalidates its derived invitation sessions.
3. A returning customer enters the email used in their access request. A six-digit, one-use code sent to that email proves ownership. The resulting session can list all retained requests matching that email, including pending, approved and closed requests. Unknown addresses get the same generic start response. A sign-in code never appears in an API response.
4. The signed-in dashboard shows request and subscription status, installation ID, user cap and license dates. Approved requests link to downloads/activation/license recovery; subscriptions link to the existing Dodo checkout, invoice/payment-method portal, payment status and period-end cancellation. Billing operations authorize the customer session against the exact request's verified email or invitation scope; the browser cannot select another customer's subscription by editing an ID.
5. Verified email can recover customer access after an original invitation expires, as long as its contact/request is retained and approved. This does not alter license expiry, activation, user count or subscription terms. An explicit **Get installer invitation** action issues a separate request-scoped one-hour link for the standalone installer. It does not rotate the original invitation, restart a trial or issue a new license. Installer links are bound to the current parent invitation and stop working when it is rotated. An invitation-scoped session cannot create an installer grant lasting beyond its own expiry. Sessions established through an installer link authorize installation/download operations only; they cannot open the billing portal or cancel subscriptions.
6. Sign-out revokes the current session in the database and clears the cookie. Sessions expire absolutely after at most 12 hours; there is no browser-stored password, bearer or vault key. Customer sign-in cannot authorize any admin operation.

Downloads and subscription pages accept the session cookie in addition to the original invitation bearer. Non-secret `?request=ID` navigation retains the selected request across reload; authorization is always server-side. Opening a valid invitation creates a session automatically and removes its fragment credential from the address bar. An existing verified-email session for the same owner is retained rather than narrowed when opening another owned invitation. Dodo return URLs go to the customer portal; redirects do not confirm payment.

## Local use

```text
pnpm sites:local
pnpm sites:mail
```

Open `http://manage.localhost:12953/`. First submit a request on the public site. Email sign-in can then show its pending status; approve it separately in Admin to enable downloads. Local sign-in messages are encrypted in `.tools/site-preview/customer-mail.jsonl`; `pnpm sites:mail` decrypts the latest simulated messages in the operator's terminal so a developer can enter the code. For a custom preview directory, use `pnpm sites:mail --work PRIVATE-PREVIEW-DIRECTORY`. This never sends outbound email and exposes no mailbox-reading HTTP route.

Restart an older local preview to load the new portal assets and apply the additional migration. Its existing D1 data, invitations and issuer/operator keys are preserved. The earlier filesystem/mock customer-account implementation remains under the legacy test flow; this portal authenticates the actual D1 access-request/licensing records instead of the mock checkout store.

## Controls and persistence

- Migration `0003_customer_portal.sql` adds encrypted challenges and customer sessions. They use a dedicated HKDF-derived key and record-specific authenticated encryption, separate from contact/trial state. Session lookups hash the exact customer origin together with a random 256-bit cookie value, preventing replay at another site's origin.
- Codes expire after 10 minutes and allow five guesses per challenge, with additional durable IP/email issuance and verification limits. Atomic D1 updates/deletion consume a successful code once, including concurrent verification attempts. Incorrect or expired codes cannot establish a session. Failed email delivery invalidates its stored challenge while retaining the generic public response.
- Browser mutations require the exact customer Origin and JSON. Public and admin surfaces reject `/api/customer/*`; customer authentication never satisfies `/api/access-admin/*`. Existing billing/installation checks still enforce approval, ownership and paid/license state.
- Challenge/session state survives runtime restart. Existing retention maintenance prunes expired authentication rows when portal support is enabled. Erased contacts and closed/rejected requests cannot regain approved capabilities merely by signing in.

The default local build enables `CUSTOMER_PORTAL_ENABLED=1`. The existing legacy combined Cloudflare deployment leaves it disabled; the future separated deployment must apply the migration and explicitly configure the feature and real email delivery. The real adapter reuses the existing Cloudflare email sender/account/token configuration (`TRIAL_EMAIL_FROM`, `CF_ACCOUNT_ID`, `TRIAL_EMAIL_API_TOKEN`) and never exposes it to the browser. Dodo account acceptance, deployment boundaries and production identity/cookie policy remain separate planned work.

## Verification

`pnpm test:sites` covers email and invitation sign-in, request scoping, expiry/replay/guess limits, concurrent verification, logout, cross-origin and admin isolation, expired invitation recovery, temporary installer grants and persistent sessions. `pnpm test:billing` includes customer-session invoice/portal access and cancellation against the mocked Dodo API, without an invitation bearer or a real charge. The browser was also checked with synthetic local data: email sign-in survived reload, pending access remained pending, and approval enabled session-authorized downloads. A screenshot is retained at `.tools/site-checks/customer-portal.png`.

The change passed 128 intake/site/customer/Cloudflare/release regression tests, the 12-test focused site suite, billing gates and `pnpm check:public-intake`. The broad log is `.tools/site-checks/portal-regression.log`; focused output is in `portal-verification.log` and `portal-billing.log` beside it. Structured receipts remain `.tools/site-checks/verification.json` and `.cloudflare-deploy/billing/verification.json`. No public deployment or live payment was part of these checks.

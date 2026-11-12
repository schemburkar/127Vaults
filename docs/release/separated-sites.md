# Separate Cloudflare websites

The site-only `Publish separated websites` GitHub workflow calls
`scripts/cloudflare/publish-sites.ps1` on the existing Windows release runner.
It requires clean, pushed local `main` at the exact dispatched commit. It does
not rebuild, relabel, upload or release installer packages. Coordinated package
releases continue through `release-set.ps1`; their Cloudflare deployment and
download verification also understand the separated configuration.

## Domains and resources

| Address | Worker | Access |
| --- | --- | --- |
| `https://127vaults.com` | `127vaults-access` | Public marketing and `/api/waitlist` only |
| `https://admin.127vaults.com` | `127vaults-access-admin` | Operator key and one-hour host-only session |
| `https://manage.127vaults.com` | `127vaults-access-customer` | Invitation or verified-email customer session |
| No public hostname | `127vaults-access-intake` | Submission-only internal service binding |

The existing D1 database and private R2 bucket retain their identities. D1 is
common control-plane state for submissions, approvals, invitations, licenses,
billing and customer sign-in. No self-hosted PostgreSQL vault data is involved.
Admin and customer backends have database-level access to the common D1 store;
this is site/API and credential separation, not table-level storage isolation.
The intake service has a D1 binding, a contact-encryption key and a rate-limit
key, without trial-decryption, operator, issuer or payment credentials. Its D1
binding still has database-level powers. The public Worker has no D1, R2 or
secret bindings. Intake can call only the named internal access-request alert
entrypoint on Admin; it cannot invoke arbitrary operator APIs.

Admin retains the operator credential. Manage does not receive it. Both private
backends need existing record-encryption and license-signing capabilities for
their respective operations. Only Admin schedules retention/billing maintenance.

### Cloud tenant workspace

The Admin Worker serves the Cloud commands under `/cloud-tenants/api/`. To enable the workspace in a hosted environment, create a dedicated Access application covering `/cloud-tenants` and `/cloud-tenants/*` on the admin hostname. Use a named identity provider with an MFA policy and configure the IdP's `amr` claim as a custom application-token claim. The Worker requires the signed `custom.amr` array to contain `mfa`. Configure this with an IdP that emits that value. The existing workspace operator key and release automation credentials do not grant Cloud permissions.

Set `cloudAdmin` in the separated deployment configuration with `accessIssuer`, `accessAudience`, `managementOrigin`, and `operators` (lowercase allowed email addresses). The management origin is the dedicated HTTPS hostname for the private listener. Protect it with an Access service-token policy scoped to the Admin Worker. In the private secrets directory, provide `cloud-management-token` (matching the management listener), `cloud-management-access-id`, and `cloud-management-access-secret`. Only the Admin Worker receives these credentials. The management audit records the verified Access subject. For tenant creation, the operator supplies an already verified control owner UUID and email.

All Workers disable workers.dev and preview URLs. Each site stages a fresh,
allowlisted asset set with its own branding copies and cache-versioned assets.

## Configuration

Add this to the existing protected `.cloudflare-deploy/config.json`; retain all
existing account, resource, catalogue, key and state paths:

```json
"sites": {
  "adminOrigin": "https://admin.127vaults.com",
  "customerOrigin": "https://manage.127vaults.com",
  "adminEmails": ["schemburkar@outlook.com"],
  "adminAccess": false,
  "emailLogin": false
}
```

`adminAccess: false` is the user-selected initial deployment policy. Admin's
static sign-in pages are reachable, but all operator data/actions require the
existing operator credential/session. The email allowlist is reserved for a
future Access policy and does **not** authenticate or restrict users by itself.
Cloudflare Access and MFA are deferred, not claimed as active protections.

`emailLogin: false` selects **manual delivery**, not disabled customer sign-in.
A customer can request a code; Admin → Customer messages shows its recipient,
subject and copyable body. The operator sends it from their own email account.
Messages are encrypted in D1, expire after ten minutes, and disappear from the
operator list when consumed, exhausted or expired. Unknown-email responses are
indistinguishable. No customer code is returned by an unauthenticated API.
Existing invitations already support operator copy/send. Previously configured
fixed-recipient request alerts are retained separately; no automatic customer
email sending or payment activation is enabled by this change.

Later, `emailLogin: true` requires `emailFrom` and the protected
`cloudflare-email-token` file for the existing Cloudflare Email Sending adapter.
Provider onboarding and real delivery acceptance remain required.

The optional [Resend customer-email integration](customer-email.md) supersedes
that Cloudflare sender configuration when `customerEmail` is present. It remains
disabled until the Resend account, domain and sending key are ready. Internal
tests use local capture/mocks exclusively; activation does not send test emails.

## Migration and invitation handling

The script backs up the existing encrypted D1 records before applying pending
additive migrations. `0003_customer_portal.sql` adds challenges/sessions;
`0004_manual_customer_mail.sql` adds encrypted manual messages. Neither moves,
reinitializes, reissues or rotates existing requests, keys or licenses.

New links use Manage. Reading/resending a stored invitation rewrites only the
old public hostname in the returned message; it does not mutate or rotate its
token, expiry, installation binding or license. Existing browser `/trial` and
`/billing` addresses redirect to Manage while retaining their query and the
browser's fragment inheritance. API requests are **not** redirected/proxied.

For an existing installer invitation, replace only `https://127vaults.com` with
`https://manage.127vaults.com`, keeping the complete path, query and fragment.
Existing installers reject redirects and use the invitation's origin for APIs,
so they require this new link. Use the existing-installation update path; do not
initialize another server or activate a new installation. Existing invitation
expiry and installation-binding checks continue to apply.

Cookies are host-only. Users sign in again on the new hosts. Customer sessions
are additionally bound to the exact origin in their database lookup. No cross-site
cookie sharing or broad CORS allowance is added.

## Run and verify

For a local site-only publication using the installed Cloudflare CLI's default
credentials, first run `cf auth whoami`, then use
`node scripts/release/cloudflare-cli-auth.mjs --sites -Revision FULL_COMMIT -Config .cloudflare-deploy/config.json`.
This runs the same checked PowerShell publication workflow. It keeps the existing
package catalogue and does not create an installer release. Add `-Plan` for the
local checks and dry-run only.

After committing and pushing the intended source, start the existing runner with
`pwsh -NoProfile -File scripts/release/runner.ps1 start`, then dispatch
`.github/workflows/sites-publish.yml` on main. The workflow runs site/runtime,
intake, deployment and public-page regressions, compiles all four Workers,
backs up D1, applies pending migrations, deploys dependencies before the public
cutover, and checks live site/API boundaries and catalogue readiness.
It also fingerprints existing encrypted request/invitation/license rows before
cutover and verifies that each remains unchanged afterward; new submissions are
allowed. No invitation token, contact plaintext or license body enters its logs.

The old public Worker's omitted secrets would otherwise be retained by
Cloudflare. The script explicitly deletes them after public cutover and verifies
that none remain. Retrying the script is supported; database/issuer identities
and package catalogues are pinned throughout. After cutover, legacy combined
configuration is rejected against this state. Older release-set verification
also refuses to overwrite an active separated configuration with its saved
combined configuration.

Private receipts live under the configured state directory:
`site-publications/<timestamp>/receipt.json`, its publication log,
`site-verification.json`, and the timestamped D1 export. Local receipts live in
`.tools/site-checks/`. Retain the original keys separately from backups.

## Optional future Access/MFA gate

Set `adminAccess: true` only when ready to configure Cloudflare Access. The
script manages an email allowlist with independent MFA and retains operator
authentication behind it. Automated verification uses a named service token
plus the operator credential, not a public bypass rule. A dedicated Access API
token may be stored in `secrets/cloudflare-access-token` or supplied through
`CLOUDFLARE_ACCESS_API_TOKEN`; it is never deployed to a Worker. Required account
permissions are Access Apps and Policies Edit, Access Service Tokens Edit, and
Access Organizations/Identity Providers/Groups Edit. The initial Wrangler OAuth
login lacks these permissions. An existing unowned Access application is never
silently replaced, and disabling an already configured gate requires a separate
explicit change. Human MFA enrollment and login acceptance must be completed
before claiming this gate is usable.

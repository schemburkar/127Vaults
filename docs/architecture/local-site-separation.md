# Separate local public, admin and customer sites

Implemented 2026-10-28 as a local architecture step. No deployed Worker, DNS, Cloudflare Access, MFA, payment account, or live data was changed.

## Run

From the repository root:

```text
pnpm sites:local
```

| Local address | Purpose | APIs exposed |
| --- | --- | --- |
| `http://localhost:12951/get-started` | Public website and Request access | `/api/waitlist` only |
| `http://admin.localhost:12952/` | 127Vaults Admin | `/api/access-admin/*` only |
| `http://manage.localhost:12953/` | Customer portal, downloads and billing | `/api/customer/*`, `/api/trials/*`, `/api/billing/*` only |

The intended production names are `127vaults.com`, `admin.127vaults.com`, and `manage.127vaults.com`. Local subdomains mirror those roles without editing DNS or the hosts file on this workstation. Cookies remain host-only; the admin session is not shared with the customer or public site. Existing local data/keys are retained; sign in again at the new host, and obtain a fresh invitation from Admin if a previously copied URL uses the old local address.

The launcher prints the path to the admin operator key. Paste that key into the existing admin sign-in. It is never printed as a value or embedded in a public asset. Submit an access request at the public site, refresh the admin inbox, approve it, and open the resulting customer invitation. Release review uses the admin's `/releases` page. Existing approval, development licensing, replacement, release and subscription management APIs remain in the control-plane implementation. Dodo is disabled until account configuration; the subscription panel reports this clearly. All outbound HTTP/email services are disabled in the local preview.

Default preview data is generated locally and stored persistently under the ignored `.tools/site-preview/` directory. Packages are explicitly labelled non-installable sample data. This verifies site and licensing flows without building, publishing, downloading or installing real packages. It does not claim installed-package or real-provider acceptance. Existing vaults, deployed records, private releases and keys are not read or modified. Restarting the preview preserves requests, operator identity, invitation bindings and accepted licenses.

Options:

```text
pnpm sites:local --work C:/PRIVATE/local-site-preview --port 12951 --admin-port 12952 --customer-port 12953
pnpm test:sites
pnpm test:billing
pnpm sites:mail
```

Run from a shell and use Ctrl+C to stop all three listeners. Preview state survives shutdown. Ports and hostnames must be different; ports must be available. Portless is optional future tooling, not required by this launcher. This preview uses HTTP and does not install a certificate authority or OS startup service. Only loopback addresses are accepted. A directory lock prevents two preview runtimes from using the same state. After a crash, stop any remaining preview processes before removing its orphaned `.preview-lock` directory; do not remove the database or identity files. The earlier `scripts/ops/private-trial-dry-run.mjs` command forwards to this launcher, explicitly using sample packages; previous prepared catalogues, installers and legacy JSONL trial records are retained but are not imported into the new D1 preview store.

`pnpm test:sites` records checks and the tested source revision in `.tools/site-checks/verification.json`. The integration suite verifies actual local HTTP listeners, Host validation, cross-origin mutation rejection, role-specific asset/API boundaries, authenticated admin sessions, request -> approval -> customer activation -> signed-license verification, and persistence across restart. `pnpm test:billing` retains the provider-mock and subscription/licensing regression coverage.

Verification for this change: the site suite passed, the billing suite passed, `pnpm check:public-intake` passed, and 124 intake/public/customer/Cloudflare/release/site regression tests passed. Broad regression output is retained in `.tools/site-checks/regression.log`; billing output is in `.tools/site-checks/billing.log` with its structured receipt at `.cloudflare-deploy/billing/verification.json`. Tests use local/synthetic records and mocked provider calls; no remote publication or real charge is performed.

## Local boundaries

- `public-website/` contains marketing and Request access. Admin and customer application sources were moved out. The public Worker entry point has only its own immutable static assets and a binding to the submission-only intake service. It has no database, R2, operator, issuer or Dodo binding.
- The internal intake Worker exposes only waitlist GET/POST. It has a contact-encryption key and rate-limit key derived separately from the private state key; it cannot decrypt trial/license records and receives no issuer, payment or operator credentials. The admin reads the same encrypted contact rows through the private backend. The intake's underlying D1 binding still has database-level powers; storage-level least privilege is part of the later deployment design.
- `admin-website/` contains only operator application pages/modules. `customer-website/` contains invitation and customer billing pages/modules, without operator API calls or a hidden operator-review mode. Legacy mock pages are excluded from every build. Each site is staged into a fresh directory from an explicit manifest. Shared branding is copied at build time, never fetched live from the public site.
- The customer root is now a [customer portal](customer-portal.md), with invitation-scoped sessions, verified-email sign-in, an owned-request dashboard and cookie-authorized billing/downloads. Local email is simulated in an encrypted outbox; no real mail or payment is sent.
- Admin and customer Workers reuse the existing control-plane implementation with explicit `SITE_SURFACE` route restrictions before any administrative authentication or mutation. Even a valid operator key/cookie cannot open admin routes at the public/customer address. Invitation and renewal URLs explicitly target the customer origin; operator alert links can target the admin origin.
- Existing administrator authentication remains required. Each site uses its own hostname (`localhost`, `admin.localhost`, `manage.localhost`), so the preview does not accidentally share host cookies merely by changing ports. No Domain cookie or cross-origin admin API allowance is introduced. Exact Origin checks remain enforced for browser mutations. Final production cookie/session policy is intentionally deferred.
- Local listeners bind to `127.0.0.1`, enforce their exact Host header, reject absolute request targets, and stream responses/downloads. The local Worker runtime uses separate per-site asset maps; arbitrary paths and directory fallbacks are not served. The public site cannot proxy another API by changing its request path.

## What this phase does not establish

The local Workers run inside one development runtime and share a development data store. This is local site/API separation, not an OS/account-level isolation claim. Production service permissions, storage isolation, dedicated deployment credentials, audit policies, Cloudflare Access/MFA and domain/cookie configuration remain the next design step.

The October local-only phase did not change production. Cloudflare scripts now support separate deployed targets and a site-only GitHub workflow through the protected `sites` configuration. See [production site deployment](../release/separated-sites.md) for role-specific credentials, retained D1/R2 state, new invitation hostnames and manual customer messages. Production Access/MFA and automated customer email are explicitly deferred for the initial configuration; the existing operator authentication remains required.

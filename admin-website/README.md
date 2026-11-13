# 127Vaults Admin workspace

Private operator workspace for customer access, activated licenses, subscriptions,
coupons, Cloud tenants, release files and customer sign-in messages. Operator-key
sign-in and the existing one-hour session remain unchanged. Cloud management
continues to require its separate authorized Cloud operator session and MFA.

## Workspace conventions

- Group navigation by Customers, Billing and Operations. The navigation finder
  searches page names only; it is not a global customer search.
- Keep the page title and page-level create actions in the page header. Search,
  views, sorting, refresh, export and pagination belong to the grid toolbar.
- Use `createDataView` in `workspace-ui.mjs` for directory views. Keep a record's
  Open action in the final column. Search reports its scope and matching count;
  sorting and paging preserve the selected view. Customer/request APIs currently
  return their full retained directory, which is filtered and paged in-browser.
- Open records in `createDrawer`. Always show the record identity and context in
  the header, then record actions above the details or save/submit actions in the
  fixed footer. Closing restores focus to the originating row. Do not include
  grid search, export or view selection in a record drawer.
- Use `enhanceSelect` for searchable customer and plan lookups. Preserve the
  underlying form value; render option descriptions as text. The combobox supports
  arrow keys, Enter and Escape, and opens above or below its input as space allows.
- Require confirmation for consequential operations, naming the customer,
  tenant, coupon or plan. Keep uncertain email outcomes protected against retries.
  Review and tests must never send real customer email or charge a payment.

Access Requests and Licenses reuse `request-drawer.mjs` and the existing guarded
access actions. Licenses describes recorded installation expiry, not a live
server-health check. Subscriptions separates existing records from new Commercial
offers. Personal signup remains in Manage. Coupons reads the configured Dodo
mode's paginated directory; search is explicitly over loaded coupons, with Load
more available when the provider has another page. No provider secrets or raw
metadata are returned to the browser.

## Local review

`pnpm sites:local` runs the local public/admin/customer applications with persistent
local state. See the printed operator-key path and admin URL.

For visual review without credentials, customer data or writes, run:

```sh
node scripts/sites/admin-review.mjs
```

Open `http://127.0.0.1:12969/access-admin`. This serves the actual admin sources
with clearly marked fictional records. All state-changing requests are refused;
Cloud's list operation is the only accepted POST and returns sample data only.
There are no real email, payment, activation or Cloud provisioning calls.
Screenshots are review artifacts, not proof that changes are published.

Run `pnpm test:sites` for the retained site-check receipt. Worker authorization,
coupon pagination, email concurrency and licensing regressions run in
`apps/public-intake/test/cloudflare-worker.test.mjs` using mocked providers.

Assets are copied from explicit allowlists in `scripts/sites/assets.mjs`. Admin
modules are not served by the separate public or customer sites. See
[local site separation](../docs/architecture/local-site-separation.md) and
[production separation](../docs/release/separated-sites.md).

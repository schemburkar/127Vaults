# 127Vaults Admin

Private operator UI for access requests, license/replacement management, release review, subscription oversight and coupon generation. The existing operator key and one-hour session remain required. No Cloudflare Access or new MFA is introduced here.

Run `pnpm sites:local` from the repository root, then open the printed admin address (default `http://admin.localhost:12952/`). Read the operator key from the printed protected key-file path. Administrative pages call only their same-origin `/api/access-admin/*` APIs. A shared sidebar links `/access-admin`, `/licenses`, `/subscriptions`, `/coupons`, and `/releases`. Each page supports operator sign-in and the same one-hour session; expired sessions hide page content. Subscription and coupon controls are separate, and billing remains disabled until Dodo configuration is ready. License rows link back to their request controls; customer invitation pages are not served by this site.

Assets are packaged by `scripts/sites/assets.mjs` from explicit allowlists. Common branding/styles are copied into each site's own build; this site never loads executable assets from the public website at runtime. See [local architecture and limits](../docs/architecture/local-site-separation.md).

Production setup and manual customer sign-in messages are documented in [separate Cloudflare sites](../docs/release/separated-sites.md). The Customer messages sidebar page provides operator-only copyable messages while automatic customer email remains disabled.

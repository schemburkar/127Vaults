# Private customer access site

The customer portal supports original-invitation sign-in and email verification codes, with a dashboard for requests, downloads, licenses and subscriptions. Invitation sessions open only their own request; verified email sessions show all matching retained requests. Customer sessions never authorize admin APIs or vault access. See [customer portal journeys and local email testing](../docs/architecture/customer-portal.md).

Manage uses separate sign-in and sign-up steps, followed by an account workspace with Overview, Subscriptions & access, Cloud workspaces, Sign-in & security, and Plans. Sections follow the session's permissions. Subscription details open in a record panel; setup and billing pages share customer navigation and a return link. Cancellation and passkey removal require an explicit confirmation.

For visual development without providers, run `node scripts/sites/manage-review.mjs` and open the printed loopback URL. All records and codes are fictional, and payment, email, activation and passkey mutations are blocked. Scenarios include `?review=email`, `invitation`, `pending`, `new` and `signedout`; this review server is excluded from deployed assets.

The local preview uses `http://manage.localhost:12953/`. Run `pnpm sites:local`, then use `pnpm sites:mail` to read simulated sign-in codes from the protected encrypted local outbox. Approval in Admin remains a separate action. The `/trial?review=1` operator-review mode was removed; release review belongs to the admin site. Common branding/styles and the setup guide are copied into this site's independent build.

Files in `legacy/` preserve the older simulated-checkout/account UI for reference and are excluded from every site build. No real checkout, email or external service is enabled by the default local preview. See [local architecture](../docs/architecture/local-site-separation.md).

For deployment on `manage.127vaults.com`, existing installation-bound links and manual email-code delivery, see [separate Cloudflare sites](../docs/release/separated-sites.md). Changing an invitation hostname does not rotate its token or change its installation/license.

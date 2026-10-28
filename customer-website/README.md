# Private customer access site

The customer portal supports original-invitation sign-in and email verification codes, with a dashboard for requests, downloads, licenses and subscriptions. Invitation sessions open only their own request; verified email sessions show all matching retained requests. Customer sessions never authorize admin APIs or vault access. See [customer portal journeys and local email testing](../docs/architecture/customer-portal.md).

The local preview uses `http://manage.localhost:12953/`. Run `pnpm sites:local`, then use `pnpm sites:mail` to read simulated sign-in codes from the protected encrypted local outbox. Approval in Admin remains a separate action. The `/trial?review=1` operator-review mode was removed; release review belongs to the admin site. Common branding/styles and the setup guide are copied into this site's independent build.

Files in `legacy/` preserve the older simulated-checkout/account UI for reference and are excluded from every site build. No real checkout, email or external service is enabled by the default local preview. See [local architecture](../docs/architecture/local-site-separation.md).

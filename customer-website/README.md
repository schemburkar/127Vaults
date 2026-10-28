# Private customer access site

Invitation-bound downloads, installation activation/replacement and customer subscription management. This site does not serve admin pages or administrative API routes. Customers use their existing private invitation bearer; the admin session is not shared with them.

The local preview uses `http://127.0.0.1:12953/`. Approval in the local admin produces links to this customer origin. The `/trial?review=1` operator-review mode was removed; review now belongs to the admin site. Common branding/styles and the setup guide are copied into this site's independent build.

Files in `legacy/` preserve the older simulated-checkout/account UI for reference and are excluded from every site build. No real checkout, email or external service is enabled by the default local preview. See [local architecture](../docs/architecture/local-site-separation.md).

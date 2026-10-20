# 127Vaults public website

## Private friend trials

For Cloudflare hosting, see the [Worker/D1/R2 deployment runbook](../docs/release/cloudflare-access-deployment.md).
The deployment scripts stage an explicit allowlist from this folder, excluding
tests, build scripts, documentation and legacy simulated-checkout pages.

The local site now includes access-admin.html for the protected operator inbox and trial.html for manually approved unpaid ten-day trials. Configure the same-origin intake API; static hosting alone cannot receive requests or issue licenses. The public release catalogue stays empty. See [private trial setup](../docs/release/private-friend-trials.md).


This folder is an independent, static marketing site. It is separate from `apps/web`, the password-manager web client, and has no third-party build dependencies.

The eight main marketing pages are Home, Product, Security, Deployment, Pricing, Downloads, Get Access, and FAQ. Separate trial/operator and legacy simulation pages support their configured services. Edit `index.html`, `downloads.html`, or `get-started.html` directly. The other five marketing pages and the linked `security-technical.html` page are generated from `build-pages.mjs`; after editing their copy, run `node public-website/build-pages.mjs` from the repository root. To regenerate only security pages, use `node public-website/build-pages.mjs security.html security-technical.html`. Keep published cryptographic parameters aligned with the implementation and run `node --test public-website/security.test.mjs`.

Every page carries a visible coming-soon notice for Cloud, proposed pricing,
and release availability. Product copy describes private vaults only; the Work
vault in the walkthrough is another private vault, not sharing. Keep these
claims aligned with the live scope and run `node --test public-website/*.test.mjs`
after editing generated or hand-written pages.

The home page contains desktop and extension walkthroughs; the Product page contains the CLI walkthrough. They use static HTML and CSS with a small `tour.mjs` enhancement for interactions. The displayed data is fictional and no walkthrough contacts a vault or fills a real page. Keep these views aligned with the clients as they evolve.

Open `index.html` directly or serve this folder with `serve`. From the repository root:

```powershell
npx serve C:\Projects\127Vaults\public-website
```

`serve` listens on all network interfaces on port 3000 by default. Tailscale Serve is not required for local-network access.

The Get Access page accepts Personal and Commercial requests with email and a user count. Commercial additionally requires contact name and organization. Cloud shows Coming soon and disables the request form; Not sure is not offered. The form activates only when a same-origin `/api/waitlist` service reports that requests are open; static preview alone keeps it disabled. The requester’s user count is visible in the operator grid and prefills the approval limit. Legacy mock-checkout pages remain separate from this access-request flow. See [the intake service](../apps/public-intake/README.md). `releases.json` remains intentionally empty; validate it with `node public-website/validate-releases.mjs` before publishing approved public artifacts.

The palette follows the desktop app's midnight navy (`#04071d`), burgundy (`#9D1F32`), and warm gold (`#E0BB95`).

The small footer theme control switches between the system color preference and the opposite theme. With no manual override, the site follows `prefers-color-scheme`, including changes made in browser developer tools. In the light palette, the body remains warm gold and main sections at zero-based indices 0, 2, 4, and so on use a translucent white `#ffffff45` background. Midnight navy remains the highlight color and burgundy is used for actions.

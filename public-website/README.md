# 127Vaults public website

## Private friend trials

The local site now includes access-admin.html for the protected operator inbox and trial.html for manually approved unpaid ten-day trials. Configure the same-origin intake API; static hosting alone cannot receive requests or issue licenses. The public release catalogue stays empty. See [private trial setup](../docs/release/private-friend-trials.md).


This folder is an independent, static marketing site. It is separate from `apps/web`, the password-manager web client, and has no third-party build dependencies.

The site has eight pages: Home, Product, Security, Deployment, Pricing, Downloads, Get Access, and FAQ. Edit `index.html`, `downloads.html`, or `get-started.html` directly. The other five pages are generated from `build-pages.mjs`; after editing their copy, run `node public-website/build-pages.mjs` from the repository root.

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

The Get Access page contains a plan-aware waitlist form. Cloud interest asks for planned vault-user seats and displays the $30 per seat annual payment and two-year total. The estimate is not a checkout. The form activates only when a same-origin `/api/waitlist` intake service reports that requests are open; plain `npx serve` keeps it disabled. An explicitly configured `/api/selfhost/mock` API can instead route Personal or Commercial requests to a clearly labeled simulated checkout with email verification, test bundle download, installation-bound test license, and local owner setup instructions. See [the experimental intake service](../apps/public-intake/README.md). The Deployment page summarizes the current self-host test package and its operator requirements. `releases.json` is intentionally empty; validate it with `node public-website/validate-releases.mjs` before publishing any approved artifact. No production checkout or public approved download is live.

The palette follows the desktop app's midnight navy (`#04071d`), burgundy (`#9D1F32`), and warm gold (`#E0BB95`).

The small footer theme control switches between the system color preference and the opposite theme. With no manual override, the site follows `prefers-color-scheme`, including changes made in browser developer tools. In the light palette, the body remains warm gold and main sections at zero-based indices 0, 2, 4, and so on use a translucent white `#ffffff45` background. Midnight navy remains the highlight color and burgundy is used for actions.

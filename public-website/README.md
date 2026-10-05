# 127Vaults public website

This folder is an independent, static marketing site. It is separate from `apps/web`, the password-manager web client, and has no third-party build dependencies.

The site has six pages: Home, Product, Security, Deployment, Pricing, and FAQ. Edit `index.html` for the home page. The other pages are generated from `build-pages.mjs`; after editing their copy, run `node public-website/build-pages.mjs` from the repository root.

Open `index.html` directly or serve this folder with `serve`. From the repository root:

```powershell
npx serve C:\Projects\127Vaults\public-website
```

`serve` listens on all network interfaces on port 3000 by default. Tailscale Serve is not required for local-network access.

The site contains no purchase, signup, or waitlist form. Review launch status and legal/product terms internally before publishing.

The palette follows the desktop app's midnight navy (`#04071d`), burgundy (`#9D1F32`), and warm gold (`#E0BB95`).

The small footer theme control switches between the system color preference and the opposite theme. With no manual override, the site follows `prefers-color-scheme`, including changes made in browser developer tools. In the light palette, the body remains warm gold and main sections at zero-based indices 0, 2, 4, and so on use a translucent white `#ffffff45` background. Midnight navy remains the highlight color and burgundy is used for actions.

# Web design system

The web MVP uses React, TypeScript, Vite, Tailwind CSS, Radix primitives, and
shared UI primitives in `packages/ui` and web-specific components in `apps/web/src`. It is a static SPA
served from the same HTTPS origin as the API. Server rendering is intentionally
excluded because decrypted vault state exists only in the browser.

## Interaction conventions

- Primary actions appear last/right on desktop and remain reachable above the
  mobile safe area. Cancel or back is the adjacent secondary action.
- Controls have a minimum 44px touch target. Icon-only controls require an
  accessible name.
- Feature screens compose shared UI primitives instead of defining button,
  input, focus, radius, or spacing styles locally.
- At phone widths, the sidebar becomes bottom navigation and dialogs become
  full-screen surfaces. Vault details remain a reversible list-to-detail flow.
- Loading, empty, error, disabled, online, and locked states must remain
  explicit. Hover cannot be the only way to discover an action.

## Migration boundary

During parity migration, React owns and renders the production component tree,
then starts the reviewed imperative behavior adapter. Historical fixture HTML is not the current product entry point. This preserves authentication,
Rust/WASM cryptography, vault CRUD, custom fields, device enrollment, and lock
behavior while screens are moved incrementally into React hooks and components.
The behavior adapter remains part of the current implementation; preserve its
authentication, encrypted-state and lock boundaries when changing it.

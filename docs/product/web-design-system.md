# Web design system

The web MVP uses React, TypeScript, Vite, Tailwind CSS, Radix primitives, and
shadcn-style components owned in `apps/web/src/components/ui`. It is a static SPA
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
then starts the reviewed imperative behavior adapter. The original HTML is
available only at `/legacy` for regression comparison. This preserves authentication,
Rust/WASM cryptography, vault CRUD, custom fields, device enrollment, and lock
behavior while screens are moved incrementally into React hooks and components.
The behavior adapter is temporary and must not receive new features.

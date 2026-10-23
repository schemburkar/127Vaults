# Repository layout

The top-level monorepo split is appropriate. Keep the existing directory names;
the useful next changes concern shared-code ownership and navigation within
components. The structure review covered tracked paths, workspace definitions,
source imports, release inputs, documentation links, and internal-suite discovery.
It was a bounded organisation review, not a full correctness or security audit.

## Where files belong

| Location | Purpose |
| --- | --- |
| `apps/` | Runnable clients, server, installer, and public intake service |
| `crates/` | Shared Rust crypto, protocol, and browser/WASM integration |
| `packages/` | Shared TypeScript/JavaScript domain, API, sync, device lifecycle, and UI code |
| `deploy/` | Installation, recovery, upgrade, and deployment templates with adjacent tests |
| `scripts/` | Development/build entry points; `ops/`, `release/`, and `cloudflare/` group operational commands |
| `tests/internal/` | Explicitly selected acceptance workflows grouped by surface, with shared support fixtures |
| `public-website/` | Marketing and access pages, site generation, assets, and adjacent tests |
| `docs/` | Maintained architecture, ADR, product, security, sync, and release documentation |

Keep workspace manifests, lockfiles, licenses, Compose entry points, and the
documented PowerShell launchers at the root. `server.mjs` is a deliberate
source-checkout and extracted-bundle command; moving it affects bundle consumers.
The public website is distinct from the vault web client and has its own staging
allowlist. Its location does not need to match the pnpm workspace layout.

Product unit tests normally belong in their component's `test/` directory.
The three UI tests now follow the other tested shared packages in
`packages/ui/test/`; `node --test` still discovers them through the existing
package command. Deployment and static-site tests can stay adjacent to the
scripts/pages they verify.

## Recommended follow-up work, in order

1. **Give shared client logic a shared owner.** The web client imports
   `apps/desktop/src/item-types.ts` and `item-browser.ts`; shared UI imports
   `apps/extension/src/passkeys.mjs`. These dependencies make an app directory
   part of another app's and a shared package's API. Extract item models and
   browsing helpers into an exported client-domain module (consider extending
   `packages/domain`), and passkey data helpers into an appropriate shared
   module. Keep browser credential operations separate from pure metadata
   parsing. Update consumers, declarations, tests, PWA build/dev asset mappings,
   server asset routes, and `scripts/release/plan.mjs` product inputs together.
   Verify web, desktop, extension, UI, and packaging before completing that move.

2. **Split large application modules by responsibility.** Good candidates are
   `apps/cli/src/client.rs`, `apps/desktop/src/app.tsx`, and
   `apps/web/mvp-client.mjs`. Extract coherent operations, hooks, or views with
   existing behavioral tests. Moving an unchanged multi-thousand-line file into
   a new directory would not address the navigation problem. Preserve the
   server's explicit legacy/PWA asset routes when extracting web modules.

3. **Classify the remaining top-level script helpers.** Browser/desktop smoke
   runners and their helpers still coexist with build/dev commands in
   `scripts/`, for example `pwa-browser-smoke.mjs` and
   `item-workspace-web-smoke.mjs`. Keep public command entry points stable;
   consider `tests/acceptance/` for reusable isolated acceptance workflows and
   continue using `tests/internal/` for retained-fixture workflows. First trace
   package scripts, dynamic imports, subprocess paths, and output directories;
   names alone do not establish that a script is obsolete or safe to replay.

4. **Clarify generated/native inputs before removing them.**
   `apps/desktop/src-tauri/gen/schemas/` contains tracked generated schemas;
   `apps/desktop/native/windows/include/json.hpp` is a large vendored header.
   Document regeneration and upstream/version ownership before deciding whether
   schemas can be ignored or the header relocated. Neither should be deleted
   solely because it is generated or large. Lockfiles and the crypto word list
   are intentional build/runtime inputs, not clutter.

## Local state and verification

The review found no tracked files matching the current Git ignore rules and no
missing local file targets in the tracked Markdown links scanned. Ignored
`node_modules/`, `target/`, `.pnpm-store/`, `.tools/`, deployment staging, local
profiles, and `.env` are workstation state. Leave them out of source moves and
retain identities and deployment state. See the
[repository content policy](../release/repository-content-policy.md).

Use `pnpm --filter @127vaults/ui test` and
`pnpm --filter @127vaults/ui check` for the UI test relocation, and
`pnpm test:internal:check` for existing acceptance-suite structure and discovery.
These checks do not run installed application acceptance or establish release
readiness. Larger moves require their affected component and release checks.

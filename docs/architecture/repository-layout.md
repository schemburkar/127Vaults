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
   Document schema regeneration before deciding whether schemas can be ignored.
   The native Windows README already identifies the header as nlohmann/json
   v3.12.0 with retained MIT licensing; preserve that ownership record and the
   offline build. Neither should be deleted
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

## Implementation handoff

Status: the UI test relocation and navigation updates are complete in commit
`9e0ca47`. The phases below are proposed work, not completed implementation.
Recheck source and instructions at the revision where implementation starts;
paths here describe the reviewed layout and may have changed since review.
Implement one phase at a time and commit each coherent, verified result to local
`main`. A later agent can start with phase 1 without undertaking every phase.

### Scope and invariants

- Preserve behavior, public command names, runtime URLs, package versions, API
  contracts, encrypted formats, metadata IDs, and existing stored data.
- Preserve unrelated changes and machine-local state. Read root and any nested
  `AGENTS.md` instructions before editing. Record the starting branch, commit,
  and worktree status; do not reset or discard another task's work.
- Use existing scripts. Do not publish packages, deploy Cloudflare, push, or tag
  as part of a source-organisation task. If publication is separately requested,
  follow the complete [release workflow](../release/release-command.md).
- Do not execute retained-fixture acceptance workflows merely to check paths.
  Discovery and structure checks are safe entry points; installed acceptance
  requires a suitable isolated fixture and the workflow's documented conditions.
- Do not change cryptographic parameters, passkey origin policy, account
  verification, secret lifetimes, persistence ordering, or error semantics as
  incidental cleanup. Extract code without redesigning these behaviors.

### Phase 0: establish the baseline and dependency inventory

From the repository root, record `git status --short`,
`git branch --show-current`, and `git rev-parse HEAD`. Read
`package.json`, `pnpm-workspace.yaml`, the affected package manifests,
`scripts/release/plan.mjs`, and `apps/server/Dockerfile`.

Useful searches (PowerShell-compatible; quote globs rather than expanding them):

```powershell
rg -n 'item-types|item-browser|passkeys[.]mjs' apps packages scripts tests docs
rg -n 'pwa-browser-smoke|item-workspace-.*smoke' apps scripts tests docs package.json
git ls-files --cached --ignored --exclude-standard
pnpm test:internal --list
pnpm test:internal:check
```

For every proposed move, inventory static imports, dynamic imports,
`new URL(..., import.meta.url)`, `import.meta.dirname`, subprocess commands,
filesystem reads, Docker `COPY` instructions, asset allowlists, release source
fingerprints, tests that inspect source text, and documentation references.
Distinguish build-time paths from emitted browser URLs. Record baseline failures
before changing code so they cannot be mistaken for refactor regressions.

### Phase 1: shared item models and browsing helpers

Preferred target: extend `@127vaults/domain` with explicit subpath exports,
keeping its existing `.` export and JavaScript consumers compatible.

| Current owner | Proposed owner |
| --- | --- |
| `apps/desktop/src/item-types.ts` | `packages/domain/src/item-types.ts` |
| `apps/desktop/src/item-browser.ts` | `packages/domain/src/item-browser.ts` |
| Pure item-type coverage in `apps/desktop/test/item-types.test.mjs` | `packages/domain/test/item-types.test.mjs` |

1. Add exports such as `@127vaults/domain/item-types` and
   `@127vaults/domain/item-browser`. Preserve the relative dependency between the
   moved files. Confirm both Vite/TypeScript resolution and the existing Node
   test runner support the chosen export targets; add the domain TypeScript
   check/configuration if needed. Do not silently replace its existing checks.
2. Add `workspace:*` dependencies to web and desktop manifests, then refresh the
   lockfile with the established pnpm version. Avoid unrelated dependency changes.
3. Update imports in desktop consumers and tests, web `src/app.tsx` and
   `src/item-workspace.tsx`, and any newly discovered consumers. Keep
   application workflow tests in their app even when they use shared helpers.
4. Update `apps/server/Dockerfile`: make the domain manifest available before
   dependency installation and copy its source into the web-build stage. Remove
   old desktop-source copies only once the web build has no consumers of them.
5. Add the domain source to desktop `productInputs` in
   `scripts/release/plan.mjs`. Server inputs already include `packages/`; remove
   obsolete explicit desktop file entries only after all consumers migrate.
   Check whether builder/cache identity code and tests need updating when the
   packaging implementation changes. A shared-source edit must invalidate every
   affected product's source fingerprint.
6. Remove old files once searches show no runtime/test/build consumers. A
   temporary re-export is acceptable only for an identified compatibility need;
   document its removal condition instead of keeping two implementations.

Done when domain, UI, desktop, and web checks/tests pass; clean-context server
build inputs include the new package; and no web import reaches into desktop
source. Preserve item field IDs, section semantics, grouping order, and locale
date behavior. Add meaningful coverage only where extraction exposes an untested
contract; do not create tests that simply assert the new filenames exist.

### Phase 2: passkey metadata ownership and runtime packaging

Start with a narrow extraction of pure metadata/encoding helpers, rather than
moving the software authenticator wholesale. Candidate owner:
`packages/domain/src/passkey-metadata.mjs` with matching declarations and an
explicit package export. Trace dependencies such as `decode`, `PASSKEY_META`,
and `readMetadata` together so the new helper has no extension API dependency.
Keep credential creation/signing and browser integration in their existing trust
boundary unless a separately justified design calls for more extraction.

Required consumer/build audit:

| File or area | Required consideration |
| --- | --- |
| `packages/ui/src/passkey-details.tsx` | Import metadata through the shared package; declare the dependency |
| `apps/extension/src/passkeys.mjs` and `.d.mts` | Use shared helpers while preserving existing public exports and declaration compatibility |
| `apps/extension/manifest.json` and provider modules | Preserve extension module loading and exposed resource scope |
| `apps/web/test/passkeys-crypto.test.mjs` | Keep credential behavior coverage; add/move pure metadata tests to the shared owner |
| `apps/web/pwa-build.mjs` | Emit every transitive raw-module dependency and include it in the service-worker digest/cache list |
| `apps/web/vite.config.ts` | Serve new raw-module dependencies during HTTPS development |
| `apps/server/src/main.mjs` | Serve equivalent dependencies for built and legacy web routes |
| `apps/server/Dockerfile` | Copy required shared manifests/sources at dependency, build, and runtime stages |
| `scripts/release/package.mjs` | Extension ZIP currently copies only manifest, popup, and `src`; package shared runtime code explicitly |
| `scripts/release/plan.mjs` | Include new shared sources for desktop, extension, and server as applicable |

Critical constraint: extension packaging and PWA assets are not all bundled by
Vite. A bare workspace import can typecheck locally and still fail in an
extracted extension or an offline PWA. Choose a deterministic staging/bundling
step in existing scripts, or emitted relative modules with explicit allowlists.
Keep one canonical implementation; generated copies must be reproducible and
excluded from source if they are build output. Do not expose an entire package
directory through a permissive HTTP route or broaden extension permissions.

Done when package/UI/web/extension/desktop checks and tests pass, extension
packaging tests verify all transitive files are inside its archive, and PWA
tests cover both emitted dependency presence and service-worker version changes
when a shared helper changes. Confirm malformed metadata rejection, exact-host
matching, user verification, and secret handling remain unchanged. Reuse an
isolated browser fixture for an offline load and extension module-load check;
record a limitation if the required fixture is unavailable.

### Phase 3: extract cohesive application modules

Do this after shared ownership is settled, in separate commits per application.
The proposed names below describe boundaries, not a requirement to create every
file or a reason to export previously private internals.

- **CLI:** keep `client.rs` as the public facade. Consider `client/transport.rs`
  for HTTP construction/error classification, `client/offline.rs` for offline
  records/unlock, and `client/removal.rs` for removal journal behavior. Inspect
  the large `impl Session` before choosing further boundaries. Use narrow
  `pub(super)` visibility where needed; preserve `Drop` cleanup, locking,
  atomic writes, and retry behavior. Update `scripts/check-cli.mjs` receipt
  source hashing so newly extracted source files remain represented.
- **Desktop:** keep `app.tsx` as composition and session ownership. Extract
  focused views or hooks into `src/components/` or `src/hooks/` where they
  already form coherent units. Preserve callback identity, effect cleanup,
  lock/revoke handling, unsaved edits, and async selection race protection.
- **Web:** keep the existing `mvp-client.mjs` entry URL. Extract stateful
  subsystems only with explicit dependencies; avoid importing the entry from a
  helper and creating an initialization cycle. Preserve `window.__vaultsActions`
  and existing custom-event names/payloads used by React and acceptance fixtures.
  Every new raw module needs the phase 2 PWA/dev/server/Docker treatment.

Done when the corresponding behavioral suite and development gate pass and a
review of the diff shows extraction rather than changed workflows. Update
source-text-based tests carefully: retain their behavioral intent instead of
deleting assertions because code moved. Do not split solely to meet a line limit.

### Phase 4: classify acceptance scripts and preserve entry points

Build a small inventory before moving scripts: current path, callers, whether it
is an entry point/helper, required fixtures, side effects, and output location.
Start with `pwa-browser-smoke.mjs`, `item-workspace-browser-smoke.mjs`,
`item-workspace-web-smoke.mjs`, `item-workspace-desktop-smoke.mjs`, and
`item-workspace-preview.mjs`. Classify the preview separately; a developer preview
server is not automatically an acceptance test.

Move reusable isolated acceptance code to `tests/acceptance/<surface>/` only
where that category fits. Keep retained-fixture cases under `tests/internal/`
and register them in `suites.json` when they are intended for its runner. Leave
build, dev, release, Cloudflare, and operator tools in their current categories.
Thin old-path launchers may preserve documented direct invocations; name one
canonical implementation and avoid running a scenario twice through discovery.

Recalculate repository roots and relative imports after each move. Preserve
environment setup before dynamic imports, browser-driver resolution, temporary
output paths, subprocess working directories, and fixture guards. Keep acceptance
execution opt-in; do not let `node --test` recursively execute a mutating runner
as a newly discovered test. Extend structure/discovery checks for the moved set
without importing live fixture workflows.

Done when public commands still resolve, every moved helper is reachable,
structure/discovery tests pass, and selected isolated scenarios run through the
existing workflow. Document unavailable OS/browser prerequisites rather than
using a production or retained user profile to get a passing result.

### Phase 5: generated schemas and native input policy

Inspect `apps/desktop/src-tauri/build.rs`, Tauri configuration, and schema
consumers. In a disposable source checkout, determine whether the pinned Tauri
build recreates `gen/schemas/` before any consumer needs it, including Linux
builds. Record the exact existing build command, required tool versions, and
whether cross-platform schema output differs. Only then decide to keep tracked
schemas or remove them from the index and add a narrow ignore rule. Verify a
clean checkout still checks/builds; do not use workstation-generated leftovers
as evidence.

Keep `native/windows/include/json.hpp` where `provider.cpp` currently includes
it. Its version and licensing are already documented in the
[native Windows README](../../apps/desktop/native/windows/README.md#third-party-headers).
Moving or replacing it has no demonstrated organisational benefit. Preserve
upstream notices, offline builds, lockfiles, and the crypto word list.

## Validation and delivery contract for the implementing agent

Run checks at the smallest affected scope first, then the relevant broader gate.
The following commands exist at review time; inspect their current definitions
before use. Some require locked dependencies, generated WASM, Rust, or native
platform prerequisites. Use the documented fixture build/setup when required.

| Changed area | Existing validation entry points |
| --- | --- |
| Shared domain/UI | `pnpm --filter @127vaults/domain check`, `pnpm --filter @127vaults/domain test`, `pnpm --filter @127vaults/ui check`, `pnpm --filter @127vaults/ui test` |
| Web/PWA | `pnpm --filter @127vaults/web check`, `pnpm --filter @127vaults/web test`; isolated browser acceptance when runtime assets change |
| Extension | `pnpm --filter @127vaults/extension check`, `pnpm --filter @127vaults/extension test`, `pnpm test:packaging` |
| Desktop | `pnpm check:desktop` (Windows/Linux native development gate) |
| CLI | `pnpm check:cli` (supports `--receipt PATH` through its underlying script) |
| Internal runner structure | `pnpm test:internal:check`, `pnpm test:internal --list` |
| Final integration | `pnpm check`, `pnpm test`, plus relevant native checks above |

For CLI receipts, use the unambiguous underlying command
`node scripts/check-cli.mjs --receipt <path-outside-checkout>`. For server Docker
or package staging changes, exercise the existing build/verification workflow
described in [local packaging](../release/local-packaging.md) and the
[release command guide](../release/release-command.md), retaining its receipts;
a test of the source tree alone cannot establish archive/container completeness.
Keep intermediate builds internal. No publication is needed to validate a move.

Each phase should deliver:

1. A focused diff with updated references, manifests/lockfile where necessary,
   staging rules, tests, and maintained documentation in the same commit.
2. A passing relevant check set, with command, exit status, source revision or
   worktree identity, and any missing platform coverage recorded outside Git as
   operational evidence. Do not commit populated profiles, logs, or credentials.
3. A search confirming obsolete paths have no active consumers. Explain any
   retained compatibility shim and when it can be removed.
4. A local `main` commit after verification, followed by `git status --short`.
   Report the commit, completed phases, remaining phases, and validation limits.
   Do not describe partially completed extraction as a finished reorganisation.

If a prerequisite blocks a phase, finish independently verifiable work and state
the exact blocker. Preserve the working tree; do not bypass release guards,
weaken a test, or remove fixture checks to complete the checklist. Avoid mixing
an unrelated bug fix into a file move; isolate it with its own behavioral evidence.

### Suggested assignment for a later agent

> Read `AGENTS.md` and `docs/architecture/repository-layout.md`. Perform phase 0,
> then implement phase 1 (shared item models and browsing helpers) as a focused,
> behavior-preserving change. Update every affected consumer, workspace manifest,
> lockfile, Docker build input, release fingerprint, and test. Run the documented
> relevant checks, verify packaging/build completeness, and commit the completed
> phase to local `main`. Preserve unrelated work and local identities. Do not
> publish, push, tag, or run retained-fixture mutations. Report the commit, checks,
> and any platform gaps. Treat phases 2–5 as separate follow-up tasks unless the
> assignment explicitly includes them.

This first assignment removes a concrete ownership problem without coupling it
to passkey trust-boundary work or three simultaneous application refactors.

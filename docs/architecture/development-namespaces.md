# Installation namespaces

The resource naming contract is `apps/cli/src/namespace-contract.json`. Rust
clients embed it and Node launch/build scripts read it. The namespace resolver
owns selection; application code must not invent independent development flags.

## Inventory and selection

| Resource / scope | Production (retained) | Development / test |
| --- | --- | --- |
| Desktop profile, per user | OS configuration directory / `127Vaults` | OS configuration directory / `127Vaults Namespaces/<namespace>/127Vaults` |
| CLI profile, per profile | `.127vaults`, explicit profile and `.127vaults-active` discovery | `<namespace root>/cli`, namespace-owned `active-profile` |
| Trust, CA, device enrollment, offline unlock, settings, replicas, queues, conflicts, rotation journals, license cache | Selected profile | Selected namespace profile; explicit paths cannot escape its root |
| Device signing keys, per user | `127Vaults device identity` | Same protected service with `(<namespace>)` suffix |
| Remembered Desktop/CLI secrets and agent capabilities | Existing protected services | Service suffix plus existing profile/account binding; no plaintext fallback |
| Agent state/lock and discovery | Selected profile | Selected namespace profile; cross-namespace calls fail before capability lookup |
| Browser native host, per user | `com.127vaults.connector` | `.development` or `.test_<instance>` suffix; scripts query the executable rather than trust a caller-selected name |
| Unpacked extension | Source / production package | `<namespace root>/extension`; distinct directory/ID and separate browser profile |
| Desktop package/OS identity | Existing product and `com.127vaults.desktop.poc` | `127Vaults Dev Desktop` / `com.127vaults.desktop.development` (test includes instance) |
| NSIS uninstall registration | Existing package | Namespace-specific Tauri identity/name and generated namespace-specific uninstall hook |
| Installer catalogue | Protected production catalogue | Combined installer refuses development/test catalogue use; it cannot install production artifacts into development |
| Server identity, keys, CA, operator files, license and backups | Existing installation | Namespace-owned `server/identity`; existing identities outside it are refused |
| Development environment/credentials | Existing `.env` untouched | Namespace-owned `server/server.env`, fresh credentials generated explicitly |
| Database, networks, volumes, containers | Existing project untouched | `vaults-development` or `vaults-test-<instance>` project; separate subnet prefix |
| Development host ports | Existing ports untouched | 12880/12881; tests require explicit UI/API/SMTP-capture ports |
| Logs/build cache | Existing release workflow | Build/cache cleanup remains separate from application reset |

`VAULTS_NAMESPACE=production|development|test` is the runtime selector. Test also
requires `VAULTS_TEST_INSTANCE` (1–40 lowercase letters/digits/hyphens, no leading
or trailing hyphen). A build stamped with `VAULTS_BUILD_NAMESPACE` rejects a
conflicting runtime selector. Debug clients reject production and require an
explicit selector. Development launchers deliberately select development when
not supplied; they reject production. Release packaging deliberately stamps
production. Child processes inherit the same selection. Unknown values never
fall back to production.

OS credential services are separate even if server/device identifiers match.
Profile validation rejects parent traversal, symlinks and Windows reparse points,
and mismatched ownership markers. Production also rejects isolated roots.
Desktop does not adopt legacy CLI data in development/test.

Production automatic import also requires an explicit `production` ownership
marker on the source profile; unclassified legacy profiles require review.
Device and credential commands use the same validated profile resolver as the
rest of the CLI. Foreign, redirected or invalid active-profile pointers produce
errors instead of silently selecting another profile. Packaged Test binaries
embed their instance ID so browser startup does not depend on inherited shell
variables. Shared namespace inputs participate in release fingerprints, and
package assembly refuses mixed installation namespaces.

## Fresh setup

1. `node scripts/namespace.mjs status` inventories resolved locations without secrets.
2. `node scripts/namespace.mjs init` previews fresh setup; `init --confirm` creates
   only the namespace marker and a new server environment file (create-only).
3. Run the printed `node server.mjs tls init ...` command for that new identity.
4. Run `dev.ps1`. Desktop and the staged extension identify themselves as Dev.
5. Enroll synthetic accounts/devices normally. Do not copy production secrets.

For direct CLI development set `VAULTS_NAMESPACE=development` before `cargo run`.
`127vaults namespace` shows the resolved namespace/profile without secrets.
For parallel tests select distinct instance IDs and explicitly assign unused
UI/API/SMTP ports. Subnet hashes are bounded: operators must resolve a rare
subnet collision before running the instances together; no identity is rotated.

The server identity path is fixed to the selected namespace's `server/identity`
to prevent rebinding its database by editing a path in the environment file.
Existing runtime secrets are compared and preserved; configuration drift requires
an explicit rotation. Development SMTP capture defaults to host port 1565;
acceptance CA files and logs also have separate per-instance paths.

Direct local client packaging supports `--namespace development --components
desktop,extension` on `scripts/release/package.mjs`. Standard coordinated releases
remain production. Development combined-installer distribution is deliberately unsupported. Run the
server, Desktop, CLI and extension with their development commands. This is the
agreed workflow, not a missing release feature. Native
passkey provider registration remains disabled by the existing product policy.

## Existing mixed-use machine and reset

The checkout had legacy CLI junctions, an active-profile pointer, a repository
`.env`, and recorded local-server workflows. None are automatically classified,
moved, deleted, enrolled or rebound. Keep existing database and installation
identity together; take the established encrypted database and identity backups
before any deliberate migration. Re-enrollment into a fresh namespace is the
default transition. Keep old profiles/queues/conflicts intact until reviewed.

The user identified the local database/instance as test data and permits
recreation if necessary. This change does **not** recreate either. No production
credentials or profile data are copied to development. A legacy installation can
remain stopped and intact as the rollback route.

`pnpm mvp:reset` previews the selected namespace, exact identity/project and
database volume. It refuses production and redirected/unowned paths. After
`pnpm mvp:stop`, `pnpm mvp:reset -- --confirm` removes only that project's database
volume. Identity/profile files and OS credentials are retained. For full isolated cleanup, stop selected apps, agents and containers, then run
`node scripts/namespace.mjs cleanup --cli target/debug/127vaults.exe` to preview.
Add `--confirm` after reviewing the targets; on Linux use the matching CLI path.
Cleanup removes owned profiles, known bound OS credentials, connector registrations,
staged extension and labelled container resources. Production, unowned/redirected
paths and running instances are refused. Credential-store failures retain profiles
for retry. Manually deleting identity metadata first can leave credentials that
cannot be derived. Legacy migration remains deliberate.

## Acceptance boundary

Local contract, path/ownership, launcher preflight, packaging regression and Rust
compile/lint checks are recorded in the verification receipt. Real Windows NSIS
side-by-side install/repair/uninstall, Linux native packages and browser-last-
installed permutations require package acceptance on those operating systems.
macOS identity naming is reserved; macOS acceptance has not been performed.
Loopback tests can be blocked by managed Windows socket permissions (10013);
those failures are not successful runtime acceptance.

The local review also runs the full Rust CLI library tests, mocked Worker
integration and PowerShell launcher checks through
`node scripts/verify-isolation-settlement.mjs`. Connector discovery now rejects
unreadable, empty, relative, missing and foreign active-profile pointers instead
of silently choosing another account. Windows cleanup was exercised on a disposable owned profile using the actual
credential backend, registration lookup and Podman inventory. Namespace and cleanup
tests also passed in Ubuntu WSL. Native installer acceptance remains a separate
release activity; Dev installer distribution is outside the agreed workflow.

## Retiring a reviewed legacy workstation installation

Namespace support does not automatically migrate pre-existing installations.
For a machine confirmed by its owner to contain only legacy development data,
stop the old server with its recorded bundle's install.mjs stop command. Run
scripts/ops/retire-legacy-installations.ps1 for a preview and add -Confirm to
archive the reviewed legacy installer/client/profile/recovery directories under
the owned development namespace. The script refuses running Vaults apps or
containers, redirected paths and foreign connector registrations; it removes
only the legacy production-name Chrome/Edge connector registrations and saves
their paths in its receipt. Data and recovery keys are retained, not erased.

The archive is retirement evidence, not a runnable migrated installation:
absolute references inside old receipts retain their original locations.
Existing database volumes and external identity directories remain preserved.
Use the normal development launchers for a fresh isolated development instance.
A first live installation must use an unused live setup link; a link already
bound to a legacy installation must not silently rebind to a new server.

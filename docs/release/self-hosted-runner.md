# Workstation release rehearsal

The manual `Local release rehearsal` workflow uses only the Windows x64
self-hosted runner with label `vaults-release`. It calls the existing workstation
checkout at `C:\Projects\127Vaults`; it does not clean, reset or replace it.
The checkout must be clean, on main, and match the dispatched GitHub commit.
Synchronize it before dispatch. Concurrent workflow runs queue without cancellation;
do not run a manual release concurrently.

## Register and check the runner

GitHub CLI must be installed and authenticated with administration access to the
private repository. From the workstation checkout, use:

```powershell
pwsh -NoProfile -File ./scripts/release/runner.ps1 register
pwsh -NoProfile -File ./scripts/release/runner.ps1 status
pwsh -NoProfile -File ./scripts/release/runner.ps1 start
```

`register` obtains the Windows x64 package from GitHub's runner-download API,
checks its SHA-256 against the official `actions/runner` release, installs it at
`C:\Projects\127Vaults-Runner`, and registers it only with this private repository.
It adds `vaults-release` alongside the default `self-hosted`, `Windows` and `X64`
labels. The default name is `<COMPUTERNAME>-127vaults-release`. It starts the
listener in the background under the current Windows account and waits for
GitHub to report it online. Repeating registration reuses the matching local
registration; it never replaces a runner belonging to another identity. Optional
`-RunnerDirectory` and `-RunnerName` select a different dedicated installation.

`start` reconnects an already registered runner without making a duplicate.
`status` checks the local/remote runner identity and reports GitHub's online and
busy status. The listener must be running to accept jobs. This is a background
user process, **not a Windows service or a login/startup task**: after logout or
reboot, run `start` again from the same build account. WSL distributions and
Podman configuration belong to that account; a SYSTEM service would not
inherit them. A separate Linux runner is unnecessary for the current job,
because the established Windows release engine invokes Ubuntu-24.04 WSL for
Linux desktop, CLI and installer builds. Split jobs may use one later.

The runner directory grants access only to the current account, SYSTEM and
Administrators. Persistent runner credentials remain there, outside the checkout.
The short-lived registration token crosses an environment variable supported by
the runner, is masked by the runner, and is removed after configuration; the
script never writes it into command arguments, source, or receipts. Installation
and status receipts are stored in that directory. Listener output is under
`logs/`; GitHub's diagnostic logs are under `_diag/`. Treat runner files as private.

Keep the runner restricted to this trusted repository and manual main runs.
Registration and status checks do not push source, dispatch a workflow, deploy,
or publish packages. The workflow must be pushed before GitHub can dispatch it,
and the workstation HEAD must match the dispatched commit. The runner can be
inspected in the repository's Settings → Actions → Runners page.

For local validation after committing, run:

```powershell
./scripts/release/rehearse.ps1 -Revision (git rev-parse HEAD) -Label local-rehearsal-1
```

`-PlanOnly` validates build planning without compiling. The default first runs
local site checks, `pnpm check` and `pnpm test`, then performs the full coordinated
build (both standalone installers and every existing gate) and previews publication.
Workspace failures stop before expensive compilation. Each label gets a separate
package output directory and release-set configuration under
`C:\Projects\127Vaults-Rehearsals`; production package paths and the production
candidate pointer are not replaced. The generated configuration resolves existing
private settings against their original directory and reuses the existing keys.
Native output is captured in `<label>.log`; `<label>.json` records each step and
its exit status, including failed runs. Detailed package receipts remain in the
existing release cache. Nothing is uploaded as an Actions artifact.

This is a rehearsal workflow. Publication preview does not execute Cloudflare's
deployment dry-run or validate remote writes. GitHub release creation and push
are omitted, not simulated successfully. Versioned notes must be prepared and
reviewed with the intended release source before a future publishing workflow.
Actual runner execution and publication remain separate validation gates.

## Local website trial

`pnpm sites:local` starts the public site at `http://localhost:12951`, Admin at
`http://admin.localhost:12952`, and the customer portal at `http://manage.localhost:12953`.
These model the intended production roles `127vaults.com`, `admin.127vaults.com`,
and `manage.127vaults.com`; they do not deploy those domains. Each listener binds
only to loopback and enforces its own Host and mutation Origin. Existing preview
state and operator keys persist under `.tools/site-preview`. Local billing and
outbound email remain disabled. No proxy, certificate trust or hosts-file change
is required on this workstation.

The rehearsal tests start and stop isolated listeners and verify the real flows;
they do not leave development servers running inside an Actions job. Run
`pnpm sites:local` separately for interactive review. The current release engine
still packages the legacy combined Cloudflare target: passing a rehearsal does
not establish separate production Workers or production domains. That deployment
migration remains a separate gate before enabling real payments.

## Complete publication workflow

`Publish coordinated release` (`.github/workflows/release-publish.yml`) is a
separate, manually dispatched main-only workflow. It uses the same Windows
runner and release concurrency group, with `contents: write` only on the
publishing job. Before dispatch, prepare and commit `docs/release/X.Y.Z.md`,
`public-website/release-notes.json`, and generated public notes; push main and
keep this workstation at that exact commit. Pass the coordinated `version`
input. No checkout is reset and no unknown work is committed automatically.

The job calls `scripts/release/publish-workflow.ps1`, which runs local sites and
workspace checks/tests, uses `release-set.ps1 build` for the complete package
set and standalone installers, and uses `release-set.ps1 publish` for the real
Cloudflare backup, compilation, migrations, private R2 upload/hash checks,
deployment and protected live delivery checks. It reruns workspace checks/tests
after deployment, confirms live versioned site notes, pushes main, fetches and
requires clean identical local/remote main with zero unpushed commits, then calls
`github.mjs` to publish the exact-source tag/release with both installer archives
and SHA-256 checksums. Existing conflicting tags or assets fail closed. Final
GitHub assets, source synchronization and receipts are checked again.

The GitHub job token is used for GitHub release APIs; local Git Credential
Manager supplies noninteractive Git pushes as it does in manual releases.
Cloudflare OAuth, R2 upload credentials and the existing issuer remain in the
build account's protected local configuration. They are not copied to workflow
YAML, Actions artifacts, or source. Native output and structured attempt receipts
stay under `C:\Projects\127Vaults-Releases\actions\actions-release-<run-id>`.

Reruns keep the same run label and get separate attempt receipts. Completed
verified package sets are reused only for the same version/source, and a
previously deployed catalogue is verified instead of redeployed. Earlier partial
uploads use the existing uploader's resume/hash checks. Retain all failed receipts.
The normal local latest-release pointer is updated only after all publication
and GitHub verification succeeds.

A read-only plan can be run after committing:

```powershell
pwsh -File scripts/release/publish-workflow.ps1 -Revision (git rev-parse HEAD) -Version X.Y.Z -Label unique-plan-label -Plan
```

This publishes the currently configured Cloudflare target. The separate
`admin.127vaults.com` and `manage.127vaults.com` Worker/domain migration is not
implied, and live Dodo collection remains disabled until merchant configuration.

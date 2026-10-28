# Workstation release rehearsal

The manual `Local release rehearsal` workflow uses only the Windows x64
self-hosted runner with label `vaults-release`. It calls the existing workstation
checkout at `C:\Projects\127Vaults`; it does not clean, reset or replace it.
The checkout must be clean, on main, and match the dispatched GitHub commit.
Synchronize it before dispatch. Concurrent workflow runs queue without cancellation;
do not run a manual release concurrently.

Register a repository-scoped runner using GitHub Settings → Actions → Runners →
New self-hosted runner → Windows x64. Follow GitHub's generated download,
checksum and registration commands in a separate directory outside the repository.
Add label `vaults-release`. Run it interactively under the same Windows account
that already has WSL, Podman, build tools and private release configuration.
A service account does not automatically inherit these prerequisites.
Keep the runner restricted to this trusted repository and manual main runs.

The workflow must be pushed before GitHub can dispatch it. This initial change
does not push or register a runner. Registration requires the repository's
short-lived registration token; do not save it in source or receipts.

For local validation after committing, run:

```powershell
./scripts/release/rehearse.ps1 -Revision (git rev-parse HEAD) -Label local-rehearsal-1
```

`-PlanOnly` validates build planning without compiling. The default performs the
full coordinated build (including both standalone installers and all existing
gates), previews publication, then runs pnpm check and pnpm test. Private logs
remain in `C:\Projects\127Vaults-Rehearsals`; package receipts remain in the
existing release cache. Nothing is uploaded as an Actions artifact.

This is a rehearsal workflow. Publication preview does not execute Cloudflare's
deployment dry-run or validate remote writes. GitHub release creation and push
are omitted, not simulated successfully. Versioned notes must be prepared and
reviewed with the intended release source before a future publishing workflow.
Actual runner execution and publication remain separate validation gates.

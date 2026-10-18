# Repository content policy

Keep product source, build definitions, schemas, synthetic automated tests,
reproducible acceptance harnesses, maintained guides, architectural decisions
and licensing review documents in Git. Tests and build scripts are necessary
to reproduce and review the product; their being internal does not make them
machine data.

Keep environment files, device profiles, certificates, logs, operator credentials,
private invitations, downloaded binaries, build caches, deployment state and
dated acceptance/checkpoint evidence outside the tracked source tree.

On this workstation, transient records are archived under
`%USERPROFILE%\.127vaults-local\evidence`, preserving their former relative
paths. Profiles are under the sibling `profiles` directory; ignored junctions
preserve existing local paths. Logs are under `logs`. A local cleanup manifest
records moved files and hashes. Existing `.env` and the active-profile pointer
are ignored in place so local workflows keep working. Do not sync this private
local directory or include it in repository exports.

Historical acceptance harnesses resolve archived records using
`VAULTS_LOCAL_EVIDENCE_ROOT`, defaulting to that local evidence directory.
They are operator workflows, not required CI unit tests. Historical results are
not a claim that the current revision passed installed acceptance.

Removing a file from the current tree does not remove earlier copies from Git
history. The private history includes earlier environment and machine data.
Do not publish it or assume a normal push transfers only current files. Create
a fresh source-only export and initialize a separate Git repository for sharing;
retain the original privately. The local preparation tool creates an export
without `.git`, local data or unreleased legal drafts, and a file inventory for
review. It does not push or claim a complete secret audit.

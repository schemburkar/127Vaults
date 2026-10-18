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
preserve existing local paths. Deployment state and secrets are under `cloudflare`,
also with an ignored compatibility junction. Logs are under `logs`. A local cleanup manifest
records moved files and hashes. Existing `.env` and the active-profile pointer
are ignored in place so local workflows keep working. Do not sync this private
local directory or include it in repository exports.

Historical acceptance harnesses resolve archived records using
`VAULTS_LOCAL_EVIDENCE_ROOT`, defaulting to that local evidence directory.
They are operator workflows, not required CI unit tests. Historical results are
not a claim that the current revision passed installed acceptance.

Removing a file from the current tree does not remove earlier copies from Git
history. Before sharing this repository, sanitize `main` to remove historical
environment files and machine-local profiles and audit reachable content. Keep
nonsensitive evidence in history. A sanitized and audited `main` can be pushed
to the intended private repository without starting a separate Git history.

Old branches, stashes, backup bundles and application checkpoint refs may still
contain the original data. Keep those private; push only the reviewed `main`,
not all refs or a mirror. Preserve artifact provenance and record mappings for
commit IDs changed by sanitization.

The local preparation tool also creates an optional source-only export without
`.git` or local machine data, with a file inventory for review. Legal drafts
remain clearly marked for private review and must be finalized before public
release. Neither the tool nor pattern scanning proves the absence of every
possible secret.

Generated WASM bindings are intentionally absent from source-only exports. Install
the locked prerequisites and run the fixture build before tests that load those
bindings. Keep generated files out of Git.

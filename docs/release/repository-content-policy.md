# Repository content policy

Track product source, build definitions, dependency locks, schemas, shared
packages, synthetic tests, maintained guides, architecture decisions and adopted
license texts. The packages directory is application source, not downloaded
packages; removing it breaks the workspace. Deployment example files contain
placeholders and are safe configuration templates, not live credentials.

Keep populated environment files, device profiles, certificates/private keys,
operator credentials, invitations, logs, deployment state, downloaded binaries,
build caches and dated operator evidence outside the tracked tree. Keep obsolete
prototypes, agent task prompts and internal legal-review notes in a private archive.
Never upload a whole working-directory ZIP as a source release.

Historical acceptance harnesses may load archived records through
VAULTS_LOCAL_EVIDENCE_ROOT (default: the operator's private local evidence folder).
These optional workflows are separate from CI unit tests. Historical outcomes do
not establish that the current revision passed installed acceptance.

Deleting files at the tip leaves previous copies in Git history. Before public
publication, review the selected branch's history and commit metadata as well as
its current files. Push only reviewed refs; do not mirror local application
checkpoints, stashes or private backup bundles. A reviewed existing main history
can be retained; a new source-only history is optional, not a license requirement.
Any history rewrite is a separate explicit operation.

The canonical legal texts are [LICENSE.md](../../LICENSE.md) and
[COMMERCIAL-LICENSE.md](../../COMMERCIAL-LICENSE.md). Further legal review and
release acceptance remain separate gates. Outside contributions require sufficient
written licensing rights; the commercial agreement is not a contributor agreement.

Generated WASM bindings are ignored. Install locked prerequisites and run the
fixture build before tests requiring those bindings. Do not commit generated
bindings, local secrets or build output to make a source checkout work.

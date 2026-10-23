# Repository workflow

The user wants completed changes committed to local Git `main`, including existing uncommitted work they explicitly ask to preserve. Finish relevant checks and commit before handing work back. Do not push unless requested; a package publication request includes standing authorization to push the completed release source and related changes on `main` to the configured GitHub remote. Preserve unrelated work and never reset or discard it.

Keep intermediate package builds internal. Test the relevant fixes before publishing one combined release to the public site/private R2 catalogue; do not publish each intermediate build.

Use existing repository scripts for recurring operational work, including builds,
installer generation, verification and Cloudflare publication. If a repeated task
is missing from those scripts, extend and test the scripts rather than repeat a
manual workaround. Run the scripted workflow and retain its verification receipts.

## Standard package publication

Every package publication must complete the full release process in
`docs/release/release-command.md`: build the coordinated packages and standalone
Windows/Linux installers, pass the built-in release gates, publish the combined
Cloudflare site/Worker and private R2 catalogue, then run the additional local
checks. Commit and push the completed release work on `main`, create the GitHub
`vX.Y.Z` tag/release at the exact package source commit, and publish versioned
release notes on both the public site and GitHub. Retain earlier site notes.

Attach that release's verified Windows/Linux standalone installer archives and
SHA-256 checksum file to every GitHub release, even when installer functionality
has not changed. Use the release's coordinated version and source provenance;
do not relabel an older installer or omit assets because its code is unchanged.
Verify uploaded assets and retain publication/check receipts before reporting
completion. Push any final related commits to `main` as well.

This process does not authorize changing repository visibility or making installer
downloads public on the website. GitHub assets retain repository visibility;
invitations, credentials and other package downloads remain protected.

# Public security copy

Describe the implemented encryption, storage model and trust boundaries in public
security pages and policies. Keep experimental/private-test status and audit-status
disclaimers in internal documentation, not public-facing copy. Do not imply an
audit or certification that has not occurred. Preserve accurate technical limits.

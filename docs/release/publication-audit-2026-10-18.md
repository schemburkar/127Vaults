# Repository publication audit — 2026-10-18

Reviewed source revision: `6571bcb`. This is a bounded local audit, not public-release
approval. No push, credential rotation, file removal or history rewrite was performed.
Secret values and personal contact details are deliberately omitted.

## Findings

### Do not publish all local refs or the complete working directory

Two historical `.env` blobs contain database-password and readiness-token values
that still match the current local environment. They are not reachable from `main`
or any of the five current server release tags. They are reachable from both
`codex/server-admin-preserve` and `codex/settings-vault-unlock`, `refs/stash`, and
nine Codex checkpoint refs. Those same refs retain machine profiles under
`.127vaults-cli/`, `.127vaults-cli-2/`, and the `.127vaults-active` pointer.
The profile records include device/server/account identifiers and trust material.
Do not publish these refs. Their presence locally does not establish prior external
exposure. If any original history has been shared, assess exposure and rotate the
matching credentials through the appropriate deployment procedure.

Ignored local `.env`, profile junctions, `.cloudflare-deploy`, `.tools`, build output
and caches remain in or accessible through the working directory. Deployment state
includes operator/intake credentials, issuer signing material and R2 credentials.
These are intentionally private and must not be included in a folder upload or ZIP.
Ignoring files does not sanitize a copied folder or historical Git objects.

### Review main's operational history before public publication

71 evidence/checkpoint paths now excluded by `.gitignore` still occur in `main`
history. Examples include:

- `docs/release/cloudflare-deployment-2026-10-16.md` (for example `d8079e3`):
  deployment identifiers and operational details.
- `docs/release/private-trial-artifacts-2026-10-16.json` (for example `0c96f08`):
  local release directories, catalogue references and rehearsal evidence paths.
- `docs/product/mvp-polish-worklog.md`: historical internal work records.

These are disclosure-review items, not confirmed credential leaks. Deletion from
the current tree does not prevent their publication when pushing main's history.
Main's author/committer metadata also contains a personal email address; decide
whether that public attribution is intended before publishing history.

### Current tracked files contain workstation and internal-host details

- `docs/architecture/implementation-interfaces.md:89` and
  `docs/release/rust-browser-fixture.md:30` include a workstation user path.
- `docs/product/server-backlog.md:36` names a specific internal host and its
  Tailscale address. The same address is reused in test fixtures in
  `apps/cli/src/tailscale.rs`, `apps/server/test/transport.test.mjs`, and
  `deploy/private-network.test.mjs`.
- Several `tests/internal/` harnesses retain machine-specific working directories
  and depend on external archived evidence. They are source, not secret files,
  but are not portable public examples without configuration/generalization.

Prefer generic user paths and synthetic host addresses before public publication.
Do not remove tests or security documentation simply because they are internal.

## Scope and results

- Inventoried 761 tracked files, all current refs, reflog-reachable paths, ignored
  top-level entries and compatibility junctions. No nonignored untracked files
  or currently tracked files matching ignore rules were found at audit start.
- Examined all 3,026 available Git blob objects, including objects outside main
  and unreachable objects. Pattern-scanned 2,917 text blobs; 109 binary blobs were
  excluded from text-pattern classification.
- Checked private-key markers, common provider-token formats, JWT shapes,
  credential-bearing database URLs, long literal credentials, private invite URL
  patterns and sensitive paths. Inspected matches: key-marker matches were scanner
  code/test strings, database URLs were local synthetic harnesses, and long literal
  matches were fixture credentials. Synthetic credentials must remain confined to
  isolated tests, not reused for deployments.
- Compared nine current local credential/key byte patterns against every blob,
  including binaries. Only the two non-main historical environment blobs matched.
  No current Cloudflare operator/intake, R2 or issuer key patterns matched.
- Separately matched the two known historical environment values against all
  blobs; neither appeared anywhere beyond those two environment blobs.
- Main and all five current server tags contain no identified environment/profile
  paths from the original cleanup. This does not independently approve those older
  tagged releases for public distribution or establish their licensing readiness.

No confirmed deployment-secret match was found in main by these checks. This is
not proof of absence: arbitrary/encoded secrets, binary contents, personal data
outside the identified patterns and all ignored caches/artifacts were not exhaustively
reviewed. No dedicated Gitleaks/TruffleHog executable was available; this audit used
local Git-object and known-value scanning. Nothing was uploaded to a scan service.

## Publication strategy remains a decision

The separate-source-export requirement is recorded in `LICENSE-POLICY.md`,
`docs/adr/0013-release-licensing.md`, and `docs/release/first-public-beta.md`.
The beta procedure exists in the initial main snapshot `8ea1370`; this establishes
repository provenance, not evidence of the owner's original instruction.

A fresh reviewed public snapshot avoids publishing the old operational records.
Keeping development history is also an option after reviewing/sanitizing the
material identified above and explicitly selecting safe refs. This audit does not
change that policy or authorize rewriting history; the owner has reopened the
choice for discussion.

## Follow-up: redundant branches removed

After the audit, the owner authorized deletion of the two old branches if their
changes were already in main. Compared all 49 commit titles on
`codex/settings-vault-unlock` and all 48 on `codex/server-admin-preserve` against
main: no missing titles. Stable patch comparisons also matched after excluding
scrubbed environment/profile files, except the initial snapshot's licensing policy,
which had been replaced during history preparation and is superseded by the
adopted current policy. No unique product changes were identified.

Both branch names were deleted locally. The stash and checkpoint refs were retained;
branch deletion does not purge historical credentials from the object database.

Traceable environment objects (values intentionally omitted):

- Initial snapshot commit `024e26a16955b1f0e4f5f210138369d3c2f76b4c`, path `.env`,
  blob `b2a41ebdee2abb28f870d8328cdda5fbbd916277`.
- Later environment change at `6f7dcfd3db6cfa9dc8337974d13285f46046b370`, path `.env`,
  blob `4ccab0207b0d70d72bfa872969e47da9e1259ea8`.
- Retained stash commit `7b8b5543a8efeb19d45127fab4c8486f921d8b45` contains the latter
  blob at `.env`; its first and second parents also contain that blob.

Both versions contain populated `POSTGRES_PASSWORD`, `VAULTS_READINESS_TOKEN`,
`VAULTS_TLS_DIR` and `VAULTS_CA_CERT_FILE`. The first two are credentials matching
the current local environment; the latter two are configuration metadata. No
private-key contents are embedded in these environment files.

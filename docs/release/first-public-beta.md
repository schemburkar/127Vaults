# Public source and beta publication

Publishing source and approving a supported product release are separate decisions.
The project remains in internal testing; use fictitious data until the
[release gates](beta-readiness.md) are accepted.

## Review the selected revision

1. Select the exact commit and review source, dependency licenses, ownership,
   notices and generated-file exclusions.
2. Scan current content and all history reachable through the refs to be published.
   Review personal commit metadata and historical operational records as well as
   credentials. Deleting a file at the tip does not remove earlier copies.
3. Run the relevant tests and reproduce artifacts from that revision. Record
   incomplete platform, security and recovery acceptance explicitly.
4. Complete the planned legal review of [LICENSE.md](../../LICENSE.md) and
   [COMMERCIAL-LICENSE.md](../../COMMERCIAL-LICENSE.md). Both are adopted version
   1.0 texts; no future AGPL conversion is promised.

## Publish only reviewed material

The existing reviewed main history may be published. A fresh source-only export
is an alternative if selected by the owner, not a required first-commit rule.
Do not rewrite history or change existing grants merely to relocate license files.

Push only the intended branch and separately approved tags. Do not mirror all local
refs, include ignored files, or copy a private Git backup. Confirm the resulting
GitHub branches, tags, workflow logs and release attachments contain only intended
material. A repository push does not authorize a website or package publication.

## Before offering a public beta

Choose the immutable release identifier, distribution date and supported platforms.
Include both adopted agreements in the release, applicable third-party notices,
checksums, signing/provenance information, setup instructions and explicit support
and experimental-format limits. Complete the release gates, including supported
export/recovery behavior. An accepted customer order must supply the required
commercial particulars and, for Cloud, its service/privacy and finite-retention
schedule. License adoption alone does not open customer signups.

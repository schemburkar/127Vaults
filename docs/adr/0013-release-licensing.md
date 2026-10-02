# ADR-0013: BSL-to-AGPL release licensing

- Status: Accepted
- Date: 2026-09-06

## Decision

Each 127Vaults release is licensed under Business Source License 1.1 at release
and changes to `AGPL-3.0-only` on a fixed Change Date exactly four years later.
The initial licensor and copyright holder is Shubhan Chemburkar. The copyright
holder offers alternative paid Personal and Commercial licenses for production
use from the initial release date.

The licenses are parallel alternatives, not cumulative requirements. Before the
Change Date, a production operator needs an applicable alternative license unless
the release-specific BSL Additional Use Grant says otherwise. After the Change
Date, an operator may use that old release under AGPLv3 without payment if they
comply with it, or acquire alternative commercial terms.

## Consequences

- 127Vaults is source-available, not OSI open source, before each Change Date.
- Changed releases are genuine AGPL open-source software, including for commercial
  use subject to AGPL obligations.
- Trademark rights remain separate.
- A release's BSL parameter block is immutable after publication.
- Security support and licensing status must be shown separately; a four-year-old
  AGPL release may be unsupported and unsafe for password storage.
- Contributor rights must permit BSL, AGPL, and commercial licensing.
- Official license enforcement is not DRM against an AGPL user modifying a changed
  release.

Legal texts and agreements require qualified legal review. The repository policy
does not itself grant rights.

Public alphas, betas, release candidates, repositories, images, and source archives
are distributions rather than licensing-free previews. Every such publication
must include complete release-specific BSL parameters and a fixed Change Date. A
prerelease label does not relax the production-use restriction or defer the start
of the four-year period.

Private development history remains private. The first public beta is a clean
source snapshot committed as the root of a new, unrelated public Git repository,
with complete BSL parameters present in that initial commit. We do not make the
private repository public or use a Git mirror/fork/squash merge as the publication
mechanism. This creates a clear distribution and licensing boundary and avoids
publishing private refs, automation logs, or earlier commit history.

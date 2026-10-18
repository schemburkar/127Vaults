# Version-scoped private downloads

Approved invitations authorize a server major, not one immutable release catalogue. New approvals store `serverMajorVersion`; all legacy experimental invitations belong to major 0. A catalogue change within that major preserves bearer links, download tickets, installation identity, signed license and trial dates. Explicit rotation still invalidates the previous bearer and tickets. Existing link expiry, closure and retention rules remain enforced.

The current catalogue is the latest published package set for its server major. `serverMajorVersion` may be explicit; otherwise the server archive filename supplies it (legacy unversioned catalogues are major 0). Each server major shares the compatible clients and supporting files from its selected catalogue; direct artifact requests use exactly the same entitlement selection as metadata.

When publishing a new major, retain the latest verified catalogue for each supported previous major in R2. Add `previousMajors` to the current catalogue, with one `{ majorVersion, objectKey, sha256 }` entry per retained major. These references are included in the release identity and pinned by the current catalogue hash. Update a reference when publishing a newer patch for that previous major. Never replace an immutable referenced catalogue object in place. Every new default catalogue must carry forward the retained-major references. Missing channels fail closed rather than serving the new major. The referenced catalogue's declared/filename major and integrity are checked before serving any package; its issuer must still verify an already issued license.

A v1 invitation therefore receives the catalogue selected for v1 even when v2 is the default. It cannot download any v2 artifacts through guessed artifact IDs, activation, invitation rotation or the operator update action. No historical trial license is rewritten. This access scope is separate from the existing signed-license plan schema.

Reinstallation and installation transfer policy are unchanged by this change. Expired private invitation links still require operator renewal; this change removes release-driven invalidation, not link expiry.

## Verification

Deployed on 2026-10-18 as Worker version `9641b3f6-9371-4c78-8559-7d8b093bd283`, retaining the existing verified 0.0.4 package catalogue. Both existing approved invitations returned HTTP 200 and current-major metadata without rotation, with the original user limits and trial expiry dates. The intake/site/publication suite passed 53 tests; the final Worker boundary suite passed 18 tests, including the additional major-1 approval/rotation case.

Fixed-recipient new-request alerts are enabled through the local deployment configuration. A synthetic request produced an `accepted` Cloudflare delivery state and its contact was erased afterward. This confirms provider acceptance, not inbox receipt. No customer invitation was sent. Recipient configuration and verification receipts remain outside Git.

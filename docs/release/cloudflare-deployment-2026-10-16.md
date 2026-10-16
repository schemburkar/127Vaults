# Cloudflare deployment — 2026-10-16

Deployed the access website at https://127vaults.com using Worker
`127vaults-access`, D1 database `127vaults-access`, and private R2 bucket
`127vaults-private-trials`. This deployment does not host the vault server.

Worker version: `cc3d088b-13a3-4225-8c80-3470870e6daf`.
Release: `friend-trial-20261016-a`, artifact source revision
`69e078a77b843f0f34bb39411d68a43d15aecf29`.

## Validation

- Publication audit passed for 21 public files and 37 private artifacts with no
  configured secret matches.
- Uploaded all 37 artifacts (945,160,077 bytes) through multipart-capable S3
  upload and downloaded every object back to verify its SHA-256.
- `cloudflare:verify` passed: intake available, unauthorized operator access
  rejected, authorized operator access working, catalogue and issuer readiness
  confirmed, private bucket settings confirmed, and protected page cache headers
  and excluded public files checked.
- Five further authenticated readiness requests returned HTTP 200.
- Public requests for the local deployment config, R2 credential file, legacy
  deployment config, and Git config returned HTTP 404.

The initial post-deployment check encountered a connection failure, and the next
verification encountered one readiness HTTP 500. A direct readiness check, a full
verification rerun, and five additional readiness checks subsequently passed.
The cause of the transient HTTP 500 was not established; monitor during the first
trial rehearsal, including Workers Free CPU headroom.

## Operation

Open https://127vaults.com/access-admin.html and use the existing operator token
from the ignored local deployment secrets directory. Invitation delivery remains
manual copy/send; no email provider was enabled.

Local inputs, credentials, and deployment state remain in the ignored
`.cloudflare-deploy` directory, outside the static asset allowlist. No credentials
are included in this record. The pre-existing untracked `deploy/cloudflare.json`
was preserved.

Before inviting testers, complete the request, approval, invitation, artifact
download/checksum, recipient-host installation, activation, rotation, and closure
rehearsal described in `cloudflare-access-deployment.md`. Deployment checks do not
establish recipient-host installation or activation success.

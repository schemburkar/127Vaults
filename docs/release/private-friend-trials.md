# Private unpaid friend trials

The request-to-trial workflow is implemented locally. Hosting, the real domain,
approved package selection and delivery of an actual email are operator steps.
Nothing in this workflow collects payment, creates a subscription, or creates a
vault account. Keep this first cut private and use fictitious vault data.

## What happens to a request

`get-started.html` submits to the same-origin `/api/waitlist`. With only static
hosting the form stays closed. With the intake service configured, requests are
encrypted in `PUBLIC_INTAKE_DATA_FILE`; they are not emailed automatically.
The inbox at `/access-admin.html` reads both old and new encrypted requests.
Open it with the operator access key from the protected token file. The inbox
supports refresh, export, decline, erasure, approval, link replacement and closure.
It is separate from the private vault-server admin console.

Approval defaults to five users, adjustable from 1 to 100. It creates a random
256-bit bearer link valid for 30 days and an email-ready message. Copy and send
that message yourself to the displayed requester address. There is no outbound
email integration in this slice. Manually confirm the recipient before sharing;
the initial request email is contact information, not a verified identity.
Anyone with the link can use it; a hard-to-guess path is not identity verification.

The recipient downloads the approved server/Desktop/CLI/extension packages,
initializes and starts the server, and reads its installation ID locally. They
enter only that UUID on the trial page. Activation signs one installation-bound
license for exactly ten 24-hour days from activation. Repeating activation for
that installation returns the same saved license. A different installation is
refused; redownloading or rotating the invitation never renews the trial.
The runtime reuses the existing commercial entitlement shape with no major-version
restriction; the trial record explicitly records `payment: none` and ten days.
It is not a paid Commercial order or a simulated payment.

Install the license locally, restart the server, and create the owner through
its private HTTPS client. Desktop/CLI can connect from a different computer:
initialize the server for a reachable private IPv4 address using `--endpoint`,
allow its port only on the intended private network, verify and trust only its
public CA certificate, then enroll each device. Web and admin ship with the
server. The extension uses an enrolled unlocked web/Desktop/CLI source.
The trial page links the existing detailed client setup guide.

At expiry the existing server policy refuses licensed writes and offers the
30-day read-only period, then its locked write state; sign-in/reads/recovery and
encrypted data are preserved. Offline clients can retain queued work. This is
the current cooperative self-hosted enforcement, not tamper-proof DRM against
an operator who controls the host, binaries, clock or installation backups.

## Prepare packages and secrets

Use a protected directory outside the repository and outside the static root:

```powershell
node scripts/ops/prepare-private-trial.mjs init C:/Private/127vaults-trials
.\release.ps1 server -Label friend-trial-1 -IssuerPublicKeys C:/Private/127vaults-trials/issuer-keys.json
.\release.ps1 desktop -Platform both -Label friend-trial-1
.\release.ps1 cli -Platform both -Label friend-trial-1
.\release.ps1 extension -Label friend-trial-1 -Version 0.1.0
```

The parent directory must already exist; init refuses an existing target.
Save/back up the intake encryption key, issuer private key and operator token
separately. Restrict filesystem access to the service operator (including Windows
ACLs); never upload this directory as static website content. Do not replace the
intake key on a retained data store: old records would become unreadable.
Rotate the operator token by replacing its protected file and restarting.
Keep the issuer stable for these trials; issuer changes require new pinned
bundles and a migration plan for existing licenses and revocations.

Release builds use committed source; commit feature changes before building.
`-IssuerPublicKeys` pins only public keys inside the server manifest and changes
its build-cache identity. Private-key PEM input is rejected. Existing old
server/Desktop packages without item deletion are not this delivery cut.
Each recipient uses the same approved binaries plus their own signed license;
there is no need to rebuild executables for every requester.

Create an external catalogue input JSON, selecting complete release directories:

```json
{
  "issuerKeyId": "trial",
  "requiredFeatureRevision": "8d95a85229c65991f3e45b4c53a22f58f0120375",
  "releaseDirectories": [
    "C:/Projects/127Vaults-Releases/server/friend-trial-1/linux-amd64",
    "C:/Projects/127Vaults-Releases/desktop/friend-trial-1/windows",
    "C:/Projects/127Vaults-Releases/desktop/friend-trial-1/linux",
    "C:/Projects/127Vaults-Releases/cli/friend-trial-1/windows",
    "C:/Projects/127Vaults-Releases/cli/friend-trial-1/linux",
    "C:/Projects/127Vaults-Releases/extension/friend-trial-1/chromium"
  ]
}
```

```powershell
node scripts/ops/prepare-private-trial.mjs catalogue C:/Private/127vaults-trials/selection.json C:/Private/127vaults-trials/catalogue.json
```

This checks release manifests, every hash, required feature ancestry and the
server's pinned issuer metadata. All four package families are required.
For a Linux hosting machine, copy the approved immutable release directories
there, update catalogue paths to their absolute host paths, and leave all
other metadata/hashes unchanged. The API rechecks hashes at startup and download.
The catalogue is operator-controlled configuration, not uploaded by a requester.
Do not replace bytes in place. Existing invitations pin their catalogue identity
and refuse a changed release. Preserve that release/service during its trial
window; a rolling catalogue migration is not implemented by link rotation.

## Host the site and API

The smallest deployment is one private directory of artifacts plus the existing
Node.js 24 intake process, behind the same HTTPS origin as the static website.
`deploy/public-trial.env.example` lists the configuration. Set those environment
variables in the service manager and run `node apps/public-intake/src/server.mjs`.
The process stays on `127.0.0.1:3101`. Run exactly one instance per data store.
It needs no PostgreSQL, vault-server access or payment provider.

`deploy/public-trial.Caddyfile` serves only `public-website/` and proxies the
waitlist/trial/operator routes to that loopback process. Set `PUBLIC_SITE_HOST`
to the real hostname and `PUBLIC_SITE_ROOT` to the static folder. Configure
automatic service restart, HTTPS, edge IP abuse limits, backups and operator-only
access to `/access-admin.html` and `/api/access-admin/*`. The token is still
required behind that access boundary. Do not cache trial APIs, license responses
or protected downloads. Never log request Authorization, cookies or fragment links.
The intake process intentionally ignores arbitrary forwarded-IP headers; apply
per-visitor limits at the trusted edge rather than trusting browser-supplied IPs.
See [Caddy's proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Cloudflare can front the site/origin; a
[Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
can connect a private origin without opening inbound origin ports. This code
uses Node files and is not a drop-in Cloudflare Pages Function/Worker.
The implemented download store is private disk streamed through the authorized
API. R2 is an optional later storage adapter, not required for the first friends.
Keep an R2 bucket private if adopting it; a public bucket URL would bypass trial
closure. [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
are time-limited bearer URLs on its S3 API endpoint, not custom-domain URLs.
No Cloudflare account resources, DNS, tunnel or public deployment are created
by local preparation.

## Revocation, privacy and recovery

- Replace private link invalidates the old bearer and download cookie immediately
  for new requests, without extending the license. Download cookies last five
  minutes and are Secure, HttpOnly and scoped to one request's artifact path.
  A download already in progress may finish after closure.
- Close trial access stops future downloads and activation and offers a signed
  revocation for an activated license. Install it on that server with
  `node server.mjs install revoke --file trial-revocation.json` and restart.
  There is no remote kill switch for an offline server. Expiry remains effective
  even without delivering revocation.
- Erase contact request removes its encrypted contact row and closes the link.
  Save the revocation before erasure. Minimal encrypted license/binding/revocation
  records remain for issuance recovery, with no requester email or organization.
  Contact records are pruned after 90 days at startup and daily when trials are
  enabled. Exports and backups need the same operator retention/erasure policy.
- Back up the encrypted request file and trial directory together, the matching
  encryption/issuer keys separately, and retain immutable packages/catalogues.
  Restore to an isolated service before resuming. Restoring an older data snapshot
  could restore a previously rotated link: rotate all surviving links after such
  a restore. No automatic key rotation or distributed store is claimed.

Before sending the first real invitation, complete the chosen host/domain setup,
download one actual package through its HTTPS private link, verify its checksum,
and install/activate on the recipient test machine. The local HTTP test covers
the application flow and existing license installer, not that host's CA, OS or
public email delivery. Public signing, legal release terms, production secrets,
billing and general public download publication remain separate release work.

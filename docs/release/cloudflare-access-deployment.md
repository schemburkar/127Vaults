# Cloudflare access website and private installer delivery

Before first publication, see the publication security review (internal record retained outside Git).
Run `pnpm cloudflare:audit .cloudflare-deploy/config.json` to repeat the publication checks
offline. These checks also run automatically before deployment operations.

Scope: public marketing/access website, encrypted access requests, operator inbox,
manual approvals, ten-day installation-bound licenses, private installer downloads,
and optional manual invitation email. The vault server, PostgreSQL, vault web client
and vault admin remain on each tester's own host. No hosted vault offering is deployed.

## Architecture

- One Worker with Static Assets: public website and same-origin `/api/*` routes.
- One D1 database: encrypted contacts and trial records, atomic version-checked
  state updates, and persistent request limits. No vault data is stored here.
- One private R2 Standard bucket: immutable packages, manifests, checksums and
  deployment-pinned catalogues. No public custom domain or r2.dev access.
- Worker secrets: contact/trial encryption master key, operator key and Ed25519
  trial issuer private key. Optional Cloudflare email API token.
- Operator sign-in exchanges the existing strong key for a one-hour HttpOnly,
  Secure, SameSite=Strict session scoped to the operator API. Authenticated
  release review reuses that session. Cloudflare Access, Tunnel, VPS,
  KV, Durable Objects and an additional CDN service are not required.

The Node/filesystem service remains supported. The Worker is a separate target;
mock checkout and customer-account simulation are deliberately not deployed.
Existing local JSONL/trial records are not automatically imported into D1. Start
with a fresh Cloudflare trial store; migrating real invitations requires a
separate reviewed migration, retaining record IDs, keys, binding and expiry.

## What is automated

`scripts/cloudflare/deploy.mjs` has explicit commands:

| Command | Action |
| --- | --- |
| `audit` | Scan publication inputs for configured credentials and validate file boundaries; no remote changes |
| `plan` | Verify all local package hashes and pinned issuer, describe the deployment; no remote changes |
| `dry-run` | Stage an allowlisted website and compile with Wrangler; no remote changes |
| `provision` | Create/reuse D1 and R2, enforce private r2.dev, reject bucket custom domains, apply D1 migrations |
| `upload` | Multipart upload private artifacts, download them back and verify SHA-256, save a pinned catalogue |
| `deploy` | Deploy Worker, website, custom domain, scheduled cleanup and secrets using Wrangler; verify endpoint |
| `all` | Provision, migrate, upload, verify and deploy in that order |
| `verify` | Check intake, unauthorized/admin API behavior, private bucket and excluded static files |
| `backup` | Export D1 with Wrangler into the protected state directory |

Importing these modules never runs their CLI commands. `plan` and `dry-run` do not
provision, upload, send email or deploy. Other commands explicitly act on the
account selected in the external configuration. No command deletes a database,
bucket or release. State is pinned to account, database, bucket and Worker names.

## One-time account setup

1. Put the chosen domain's DNS zone in the intended Cloudflare account. Complete
   nameserver onboarding. Our public hostname is
   `https://127vaults.com`. The custom domain must be in that account;
   resolve any conflicting existing DNS/service attachment before deployment.
2. Enable R2 billing/usage for that account. Use Standard storage. Enabling R2
   may require billing details even if actual usage stays within the free tier.
3. Install repository dependencies with `pnpm install --frozen-lockfile`.
   Wrangler, the local runtime and upload SDK are version-pinned in the lockfile.
4. Authenticate the pinned CLI with `pnpm exec wrangler login`, then inspect
   `pnpm exec wrangler whoami`. Alternatively set `CLOUDFLARE_API_TOKEN` for an
   automation identity with Workers Scripts edit, D1 edit, R2 edit, and the zone
   permissions needed for Worker custom-domain deployment. Scope it to the
   intended account/zone. The scripts set `CLOUDFLARE_ACCOUNT_ID` from configuration.
5. For installer upload, create R2 S3 credentials with Object Read & Write access
   scoped to the dedicated bucket. After provisioning it, set `R2_ACCESS_KEY_ID`
   and `R2_SECRET_ACCESS_KEY` in the deployment process environment. These are
   deployment-only credentials; they are never sent to the browser or Worker.
6. Email is optional. For manual copy/send, omit `emailFrom` from configuration.
   For the integrated Send invitation button, onboard a sending domain, configure
   its DNS, and create an Email Sending API token. Arbitrary-recipient sending
   requires Workers Paid. The script does not enable a paid plan automatically.

Wrangler handles account provisioning, migrations, Worker/assets/secrets and
custom-domain deployment. Wrangler's individual R2 object upload is limited to
315 MB, below our approximately 835 MB server archive, so the upload step uses
the official S3-compatible SDK with multipart uploads. No separate AWS account,
AWS service, AWS CLI or additional hosting product is needed.

## Prepare protected local inputs

Retain the existing issuer that matches the selected server bundle. Do not
generate a fresh issuer for existing packages: the preflight deliberately refuses
that mismatch. Existing `prepare-private-trial.mjs init` can create a new protected
secret directory for a genuinely new release; the server bundle must pin its public key.

The secret directory must contain:

```text
intake-key                 64 hexadecimal characters; preserve it across deployments
operator-token             strong 43–128 character base64url credential
issuer.pem                 Ed25519 PKCS#8 private key matching the server bundle
cloudflare-email-token     optional; required only when emailFrom is configured
```

Use `prepare-private-trial.mjs catalogue` and the existing release workflow to
create the approved local catalogue. It includes the complete package selection
and SHA-256 metadata. Reuse the selected friend-trial catalogue only after its
normal release verification; historical packages lacking required features are
not substituted by the Cloudflare scripts.

Copy `deploy/cloudflare.example.json` to `.cloudflare-deploy/config.json` and edit
the account ID, hostname, resource names, release ID and paths. Relative paths
resolve against that configuration file, not the current shell directory.
Use this layout inside the project:

```text
.cloudflare-deploy/
  config.json
  catalogue.json
  secrets/
    intake-key
    operator-token
    issuer.pem
  state/
```

Paths in that configuration can be `./catalogue.json`, `./secrets` and `./state`.
The entire `.cloudflare-deploy/` folder is excluded from Git, Docker build context
and public website staging. It is the only allowed private deployment directory
inside the checkout; external protected directories remain supported. Directory
junctions/symlinks are resolved before validation, so they cannot redirect private
files into public source folders. Keep secret and state directories separate.
Protect `.cloudflare-deploy/` before copying existing keys there. The state directory receives
restricted Windows ACLs or Unix mode 0700; do not place it in a web-served folder.
The scripts read existing secrets without replacing their contents or permissions.

Example invocation, after editing your external configuration:

```powershell
pnpm cloudflare:plan .cloudflare-deploy/config.json
pnpm cloudflare:dry-run .cloudflare-deploy/config.json
pnpm cloudflare:provision .cloudflare-deploy/config.json
# Create the bucket-scoped R2 credentials and set them in this process's environment.
pnpm cloudflare:upload .cloudflare-deploy/config.json
pnpm cloudflare:deploy .cloudflare-deploy/config.json
pnpm cloudflare:verify .cloudflare-deploy/config.json
```

Once account and R2 credentials are ready, `pnpm cloudflare:all <config.json>`
automates the complete sequence. The commands fail on errors and do not proceed
to deployment after a failed migration, upload or checksum check. Provisioning
is resumable; completed immutable uploads are verified and reused. Preserve the
external `state.json` and `r2-catalogue.json` as deployment records.
On the first custom-domain deployment, DNS/TLS activation may take time. If code
deployment succeeds but endpoint verification fails during propagation, wait for
the hostname to become active and rerun `cloudflare:verify`; no reinstall or
artifact upload is needed. State records deployment and verification separately.

## Storage and authorization behavior

### Website caching

Public pages use extensionless URLs such as `/pricing` and `/downloads`, with `/`
for the homepage. Native Static Assets `drop-trailing-slash` handling redirects
legacy `.html` and trailing-slash URLs. Staging rewrites internal HTML navigation
to canonical paths, and new Cloudflare trial invitations use `/trial#...`.
Existing invitation fragments are retained by browsers across the legacy redirect.
Both legacy and canonical trial/admin paths have `no-store` header rules.

Workers Static Assets provides Cloudflare edge caching automatically, without a
zone-level Cache Everything rule. Public HTML and `releases.json` retain the
default `public, max-age=0, must-revalidate` browser policy and ETags, so browsers
check for updates before reuse. CSS and JavaScript modules use
`public, max-age=86400, must-revalidate`: a one-day browser lifetime. Staging
automatically replaces their HTML reference query versions with a digest of the
approved website content. A changed release therefore requests new asset URLs
instead of reusing stale browser copies. Cloudflare purges alone cannot clear
visitors' browser caches. Already-open pages still need to be reloaded.

`trial.html`, `access-admin.html`, and all Worker API responses (including
authorized installer downloads) retain `no-store`. Static JavaScript contains
code only; credentials and trial data arrive through uncached APIs. The generated
`_headers` file carries these settings with every deployment. No extra caching
service or paid feature is required. `cf rulesets list --zone <domain>` can inspect
zone overrides; publishing this repository still uses its pinned Wrangler deploy
script. The installed `cf deploy` uses a different build-output format.

Object keys contain release ID, artifact ID and SHA-256. Catalogues have their
own content-addressed keys and record the verified R2 ETags. Before deployment,
every remote object is streamed back and SHA-256 checked. Downloads use an R2
conditional GET against the pinned ETag and expected size/checksum metadata;
the Worker does not buffer or hash an entire installer per visitor request.
R2 ETags are transport version checks, not release SHA-256 hashes.
The Worker also checks the catalogue bytes against a SHA-256 pinned in its
deployment configuration before trusting any catalogue metadata. Authorized HEAD
and single HTTP byte ranges support checking and resuming large downloads.

All APIs use `Cache-Control: no-store`. Installer requests require the private
trial bearer or a five-minute, HttpOnly, Secure, same-site download cookie scoped
to that request's artifact path. There are no public presigned URLs. Rotation
invalidates old links and cookies; closure refuses new downloads and activation.
A download already authorized and in progress may finish. Downloaded packages
cannot be recalled, and an offline self-hosted license requires its signed
revocation to be installed locally.

License and revocation signatures use the existing server wire format. Trial
activation saves one ten-day license, bound to one installation. D1 version
checks prevent concurrent approvals, activations or stale operator requests from
overwriting each other. A racing operation may return `state_changed` (409);
refresh/retry explicitly. Repeating activation after success returns the existing
license and expiry rather than renewing it.

The operator key is never embedded in static assets or URLs. Browser sign-in
uses a one-hour HttpOnly, Secure, SameSite=Strict session cookie; sign-out clears
the session. There is one operator identity; per-person accounts and MFA remain
unimplemented. Operator release review uses the same session, not a separate
reviewer key.

## Email and retention

Approval never sends email automatically. Optional sending claims the attempt
in D1 before provider I/O. Lost/ambiguous responses stay sending/unknown rather
than being auto-retried. A concurrent link rotation/closure cannot be overwritten
by a delayed provider response. Check email activity before deliberately rotating
and sending again. Without email configuration, Review invitation and Copy remain
available for your existing mail client.

An hourly scheduled task erases contact and invitation data older than 90 days,
closes access, retains minimal encrypted issuance/revocation evidence and prunes
expired limit rows. It processes at most 100 expired contacts per invocation,
appropriate for this internal group. Authorization also refuses expired contact
records before cleanup runs. Scale this bounded cleanup before general launch.

## Costs and operational checks

Review the current Workers, D1 and R2 quotas and pricing for the selected account
before deployment. Measure the package set from its manifests. Local tests and
bundling do not establish deployed CPU or storage headroom; inspect invocation
metrics and usage during the rehearsal. Quota exhaustion can interrupt service.
No script automatically upgrades billing or promises an account-wide spending
cap. Retain supported releases according to the agreed retention policy.

Official references to check at deployment time:

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [R2 uploads and Wrangler limit](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Email pricing](https://developers.cloudflare.com/email-service/platform/pricing/)

Before inviting real testers, complete one explicit HTTPS request, operator
approval, invitation delivery, large artifact download/checksum, recipient-host
installation, activation, rotation and closure rehearsal. Use synthetic vault
data. Verify operator failure responses, private bucket access and scheduled task
health. Observability is disabled by default to avoid collecting invitation paths
and authorization material; add intentional redacted operational monitoring.

## Backup, update and rollback

Run `pnpm cloudflare:backup <config.json>` before schema or release changes. Back
up the encryption and issuer keys separately from the encrypted D1 export. Keep
approved immutable packages, catalogues and deployment state. A restored older
database may revive old links; rotate all surviving links after recovery before
reopening the website. Restore into an isolated database first and verify it.
Backup only needs the deployment configuration/state and CLI authentication;
it does not depend on local installers or loading the private issuer key.

Keep the issuer and encryption key stable across deployments unless performing an
explicit migration. Rotate the operator token in its protected file and redeploy;
existing operator browser credentials then fail. API token rotation is separate.

Existing invitations pin a logical release identity. Moving identical artifact
metadata from disk to R2 preserves that digest, but D1 records are not imported
automatically. Deploying a different release catalogue causes existing approvals
to refuse downloads/activation; link rotation does not migrate releases. Preserve
the old deployment/catalogue during its trial window or plan a separate migration.
Do not switch releases casually while trials are active.

Worker rollback is available through `pnpm exec wrangler rollback --config <external-state>/wrangler.json`.
It rolls back Worker code/configuration, not D1 schema/data or R2 objects. Verify
schema compatibility before using it. No automatic destructive rollback is provided.

## Local implementation evidence — October 16, 2026

- `pnpm check` passed, including existing web/Desktop builds, native Desktop and
  API contracts. The new Worker and deployment scripts are included in the public
  intake syntax checks.
- `pnpm test` passed across the existing workspace and root suites. The shared
  request validator preserves the Node service's existing behavior.
- `pnpm cloudflare:test` passed 21 focused checks, using the actual local Workers
  runtime with D1/R2, a fresh persisted-runtime restart, existing server license
  and revocation verification, concurrent writes, expiry, retention, optional
  email interruption/closure, private HTTP ranges, actual static asset routing,
  full deployment orchestration and an S3 HTTP multipart-upload rehearsal. A
  separate check uses the newer runtime bundled with the pinned Wrangler CLI.
- The CLI's offline `plan` and Wrangler `dry-run` were exercised against the
  actual selected 37-file friend-trial catalogue: 945,160,077 bytes, package source
  `69e078a77b843f0f34bb39411d68a43d15aecf29`. Every local artifact hash and the
  existing pinned issuer matched. No secrets were printed or replaced.
- No Cloudflare account resources, DNS, public Worker, live R2 uploads or real
  invitation emails were created. Actual account deployment, large HTTPS
  download/install/activation, DNS/TLS, delivery and Free-plan CPU acceptance
  remain deployment checks, not claims established by these local tests.

## New-access-request alerts to the operator

Prepared, disabled by default. Verify the operator destination in Cloudflare Email Service and onboard the sender's domain before enabling. The user selected an Outlook plus-address; keep the actual recipient in the ignored deployment config, not public JavaScript or source. No recipient confirmation or sending capability has been established in this test pass.

After verification, add both `requestAlertTo` (the verified inbox) and `requestAlertFrom` (a sender at the site's own domain) to the currently deployed private configuration. Deployment creates a `REQUEST_ALERTS` send binding restricted to that single recipient. The Worker submits a plain-text summary of a newly persisted request: contact email/name/organization, plan, requested users, timestamp and the normal operator inbox URL. It never includes an operator key, private trial link, license or vault credentials. Honeypots do not send alerts.

The request is saved before sending. Delivery work uses the Worker lifetime extension; provider failure cannot lose the request or turn acceptance into an error. A durable attempt claim prevents automatic resending after an ambiguous result. The access desk reports whether alerts are configured and whether each submission was accepted by the provider or remains unconfirmed. Provider acceptance does not establish inbox delivery. A real verified-inbox test remains required before claiming this feature is enabled.

Cloudflare's current [Workers sending API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) supports structured messages, so this needs no extra mail library or sending API token. Its [send binding configuration](https://developers.cloudflare.com/email-service/configuration/send-bindings/) can restrict a binding to one destination; sender/domain and destination verification remain operator setup steps. This is separate from sending trial invitations to arbitrary applicants.

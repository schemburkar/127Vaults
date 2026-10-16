# Cloudflare publication security review — October 16, 2026

Reviewed the deployment code and actual selected friend-trial payload before any
account deployment. No project signing, intake-encryption or operator secret was
found in the delivery files examined. This is a publication-boundary review, not
a claim that the entire product has received a penetration test.

## What leaves the deployment computer

| Destination | Intended content | Access boundary |
| --- | --- | --- |
| Public Static Assets | 21 explicitly selected website files, plus generated header/redirect rules | Public; operator/trial HTML is a shell with no embedded records or credentials |
| Worker code | Runtime API modules and non-secret binding/configuration names | Backend code; never included in the public asset directory |
| Worker secrets | Intake encryption key, operator credential, trial issuer private key; optional email token | Intentionally uploaded to Cloudflare's private Worker secret bindings; these are needed to run licensing and encryption |
| D1 | Schema on provisioning; encrypted contact/trial records as the service is used; keyed limiter identifiers | Worker binding and privileged account access; no local request/recipient database is imported |
| Private R2 | 37 selected release/supporting files, 945,160,077 bytes, plus a content-addressed catalogue | Bucket must have no public custom domains and disabled r2.dev; downloads require application authorization |
| Deployment computer only | R2 S3 credentials, Cloudflare CLI account token, local selection/state/backups | Neither uploader credentials nor local data directories are placed in Worker secrets or static assets by these scripts |

Installer archives contain the distributed server software and public issuer
keys. They do not contain the real trial issuer private key or an initialized
vault. Recipient TLS/runtime secrets are generated/stored on the recipient host
and mounted at runtime, outside the distribution archive.

## Safeguards added during review

1. **Strict catalogue fields.** Previously arbitrary extra JSON fields could be
   uploaded or forwarded as artifact metadata. Unknown catalogue/artifact fields
   now fail preflight, and API metadata uses an explicit field allowlist.
   Public-key slots reject private-key PEMs. Obvious secret/backup/request/license
   filenames and unsupported artifact extensions are refused.
2. **No symbolic-link following for static publication.** Approved filenames must
   be direct regular files within the website directory. Staging uses checked
   file handles, rather than copying a link target blindly.
3. **Publication credential scan.** Before plan/dry-run/provision/upload/deploy,
   scan the catalogue, all public assets and selected artifact bytes for the
   configured secrets. Include JSON-escaped strings, raw hex encryption material
   and DER issuer bytes. Reject standalone text/public PEM private keys, and
   reject a nonempty public release catalogue for this private-trial deployment.
   Errors never print matched secret values. `cloudflare:audit` runs this check
   without contacting or changing Cloudflare.
4. **Minimize deployment extras.** Preview and workers.dev URLs remain disabled,
   and source-map uploads are explicitly disabled. Temporary Worker secret files
   are restricted and removed in `finally` on normal success/failure; abrupt
   process termination can leave a restricted temporary file in the protected
   state directory.

Existing protections retained: authenticated admin APIs, same-origin mutations,
encrypted D1 contact/trial records, version-checked writes, private R2 binding,
checksum/ETag-pinned downloads, scoped short-lived download cookies, no-store API
responses, and no automatic invitation sends. Closing/rotating trials invalidates
new requests; an already authorized stream can finish.

## Actual payload evidence

- Exact selected files passed local SHA-256 and issuer pin checks.
- All 21 public files and 37 selected artifacts passed the configured-secret scan.
- Separately inspected 26,054 tar entries (including nested container image
  layers and CLI tarballs) and 24 ZIP entries after decompression. No configured
  project secrets or parent/absolute archive paths were found in those entries.
- The bundled server/PostgreSQL images include GnuTLS library example-key bytes;
  the PostgreSQL base image also includes Debian's stock
  `/etc/ssl/private/ssl-cert-snakeoil.key`. These are third-party image material,
  not the project's issuer/encryption/operator credentials. Our supplied Compose
  configuration does not select that snakeoil key: the database has no published
  host port and uses the internal backend network; server HTTPS uses the
  recipient's `/run/secrets/tls/server.key` mount. Do not enable TLS later using
  that bundled default certificate/key. These existing immutable installers were
  not rebuilt or modified during this review.
- Generic PEM matching is intentionally not a blanket rejection of opaque
  third-party binaries/images because of those publicly distributed key fixtures.
  The automated gate still rejects configured project secrets in every raw
  artifact. It does not unpack every executable/AppImage/Debian package or prove
  absence of arbitrary unknown secrets in compressed content. The decompressed
  archive inspection above is separate evidence for this selected release.
- No account deployment, real invitation email or remote artifact upload was run.
- Publication regressions cover strict fields/private-key slots, secret matches
  across stream boundaries, escaped PEMs, public catalogue closure, static
  junction refusal and rejection before the first uploader network request.

## Live checks at deployment

The scripts check R2 privacy before uploads and deployment and again during
endpoint verification. Account administrators can change public bucket access
later; local review cannot certify future account settings. Use the dedicated
bucket and scoped credentials, retain those checks, and complete the documented
HTTPS request/download/activation rehearsal after DNS/TLS is active.

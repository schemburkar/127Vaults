# Unpaid private trial delivery — October 16, 2026

Local implementation and package preparation are complete. The first live friend
invitation still needs the selected public hostname and deployed intake/static
service. No remote push, public deployment, real email or payment was performed.

## Delivered

- Protected public-site access-request inbox with legacy encrypted request reads,
  refresh/export, approve, decline, erase, replace-link and close actions.
- Email-ready manual invitation; one random bearer link per approval, 30-day link
  availability, explicit rotation, per-request protected downloads and checksums.
- Recipient setup page, custom installation-bound five-user default (operator
  adjustable) license, exactly ten days from activation, idempotent activation and
  rejection of a different installation. No simulated purchase or paid state.
- Existing server read-only expiry and higher-sequence policies retained. Closure
  provides an installation-bound revocation; an offline server needs that file
  installed locally. Contact erasure and 90-day contact retention are implemented.
- Trial issuer pinning in server release builds, cache separation by public key,
  secret initialization outside the repository with restricted Windows ACLs,
  and a verified private artifact catalogue.

The runtime feature commit is `69e078a77b843f0f34bb39411d68a43d15aecf29`.
The final preparation follow-up adds clearer Windows/Docker instructions and
restricts newly generated Windows secret directories before writing keys.

## Packages and concrete checks

The [artifact record](private-trial-artifacts-2026-10-16.json) selects six verified
release directories and 37 files, including seven install/archive payloads.
Server/web/admin, Windows/Linux Desktop and extension were rebuilt as
`friend-trial-20261016-a` from `69e078a`; existing Windows/Linux CLI
`internal-20261016-c` from deletion commit `8d95a85` were reverified and selected.
The required feature ancestry check rejects old packages without deletion.
The server's bundle manifest pins the actual selected trial public issuer key.
No private key or operator token is tracked or included in a package.

Existing focused suites passed: intake/customer/mock/trial flows, public website,
license installer/revocation and release-tool checks. Two new HTTP/storage tests
exercise the actual encrypted request, operator approval, denial without access,
Origin refusal, file delivery, durable license/retry, installation binding,
ten-day expiry, link/cookie rotation, tampered-file refusal, signed revocation,
erasure and retention. A focused release test verifies that issuer changes alter
the server cache key and that private-key input is refused.
Both Desktop builds passed 37 UI/component tests, native checks and the shared
88-pass CLI library suite (one explicitly opt-in live test ignored), then native
host framing/startup checks. Server checks, 79 web tests and installer/operator
checks passed during packaging. Extension packaging passed 28 product tests.
Basic browser visual inspection checked the operator page and missing-link state;
no actual HTTPS browser approval/installation ceremony is claimed.

The new disposable recipient rehearsal used
`C:/Projects/127Vaults-trial-delivery-20261016-a`, preserving retained fixtures.
It:

1. Verified and extracted the new server archive; initialized a new identity,
   started its actual PostgreSQL/server containers and read its installation UUID.
2. Submitted a synthetic request through the real intake handler, read it in the
   operator API, and approved an unpaid five-user trial.
3. Streamed the entire 835,085,312-byte server archive through the authenticated
   trial download API and matched SHA-256
   `2a648b33b72d591dc887216095081210e50a374a1c98b2030357a1a2dcbc9e30`.
4. Activated the actual installation, verified exactly ten days of validity,
   confirmed repeat activation returns the exact license, and installed that
   file through the extracted server's pinned-key operator command.
5. Restarted the server and observed signed license **active**, trusted clock,
   five available seats, expiry **October 26, 2026 at 11:58:50 IST**. Its served
   HTTPS web client returned HTTP 200 with explicit verification of its new CA.
6. Stopped the disposable containers, retaining their identity and data volume.
   No owner was enrolled, SMTP configured, real recipient contacted, global CA
   trust changed or earlier Windows GUI launch restriction bypassed.

Machine-readable evidence remains in the protected work directory at
`rehearsal-evidence.json`; the catalogue at `catalogue.json` is ready for local
service configuration. Move approved artifacts to the actual host and adjust
only catalogue filesystem paths before starting its service.

## Before sending the first invitation

Follow the [operating guide](private-friend-trials.md): choose the real host/domain,
deploy the static site and Node intake service under the same HTTPS origin,
configure protected keys/data/catalogue paths, edge abuse controls and operator
access, and verify one actual browser download on that deployment. Send the
prepared email yourself. Caddy configuration and environment examples are included.
Private disk is implemented; Cloudflare can front the origin. An R2 adapter is
optional future work, not part of this completed local delivery implementation.

These are unsigned private experimental packages for fictitious vault data.
Physical recipient installation, public signing/legal distribution, production
secrets, payments and a tamper-proof self-hosted entitlement system are unclaimed.

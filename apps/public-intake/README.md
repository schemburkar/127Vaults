# Public waitlist intake (experimental)

## Cloudflare deployment target

The separate `cloudflare/worker.mjs` target runs the access/trial APIs in Workers,
with encrypted D1 records and private R2 artifact streaming. It serves the existing
website through Static Assets and uses the existing operator bearer key; no VPS,
Tunnel or Cloudflare Access is required. See the [Cloudflare deployment runbook](../../docs/release/cloudflare-access-deployment.md)
for account prerequisites, offline validation, automated provisioning, multipart
uploads, secrets, deployment, verification and backup. This hosts distribution
and licensing only, never the tester's vault server.

## Unpaid private trials

A separate manually approved trial path is now available with PUBLIC_TRIALS=1 (keep the simulated checkout disabled). The operator inbox at /access-admin.html can review/export/erase requests, approve ten-day trials and rotate/close links. The recipient page activates one installation-bound license and streams approved private downloads. A manual Send invitation button uses Cloudflare Email Sending when configured; copy/email remains available. Approval does not automatically send email. See [the setup and operating guide](../../docs/release/private-friend-trials.md).


This is a separate HTTP API intended to sit behind a reviewed HTTPS reverse proxy at the public website's origin. The static website sends `GET` and `POST` requests to `/api/waitlist`. `npx serve` serves only the static pages, so the form stays disabled in that preview.

The API accepts Personal and Commercial access requests with contact email, a required vault-user count from 1 to 100, and consent. Commercial also requires contact name and organization. Cloud and undecided submissions are rejected. This is requested trial capacity, not a purchase or entitlement. It writes encrypted JSON Lines records with AES-256-GCM. The intake operation does not create a vault user, customer account, purchase, or license. It never asks for vault credentials. Older encrypted records remain readable.

For a disposable local test, set `PUBLIC_INTAKE_ORIGIN` to the exact HTTPS website origin, `PUBLIC_INTAKE_KEY_FILE` to a protected file containing a 64-character random hex key, and `PUBLIC_INTAKE_DATA_FILE` to an absolute path for the encrypted records. `PUBLIC_INTAKE_PORT` defaults to 3101. Run `node apps/public-intake/src/server.mjs`; it binds to loopback only. A reverse proxy must terminate HTTPS and route `/api/waitlist` to it. Do not expose this process directly to the Internet.

The unpaid-trial path adds operator export/erasure and 90-day contact retention. General public intake still needs reviewed edge abuse controls, key rotation and recovery, backup/retention policy, legal privacy copy, monitored mail delivery and deployment review. The private trial slice is not general public launch approval.

## Supervised self-hosted signup simulation

An explicit `PUBLIC_MOCK_SELFHOST=1` opt-in adds a **test-only** self-hosted signup path. It requires an existing server bundle archive, SMTP-over-TLS credentials, and a separate Ed25519 test issuer key. The customer requests Personal or Commercial access, verifies a six-digit email code, acknowledges a simulated checkout, downloads the test archive, installs a private server, enters its installation ID, and downloads an installation-bound test license plus the issuer public key file. The order and access-token digest are stored in encrypted per-order files. The access token is returned once to the browser; email code recovery rotates it if lost. No card data, payment, invoice, production entitlement, or verified billing account is created.

Set `PUBLIC_MOCK_SELFHOST_DATA_DIR`, `PUBLIC_MOCK_SELFHOST_BUNDLE_FILE` (the `.tar` archive created alongside `node server.mjs bundle <directory>`), `PUBLIC_MOCK_SELFHOST_ISSUER_KEY_FILE`, `PUBLIC_MOCK_SMTP_HOST`, `PUBLIC_MOCK_SMTP_PORT` (default 465), `PUBLIC_MOCK_SMTP_USERNAME`, `PUBLIC_MOCK_SMTP_PASSWORD_FILE`, and `PUBLIC_MOCK_SMTP_FROM`. Keep the issuer private key and intake encryption key in separate protected locations outside the website and bundle. The SMTP sender must be approved for the configured origin. The service remains loopback-bound behind the exact-origin HTTPS proxy.

For a disposable local rehearsal, create the issuer key with `node scripts/ops/mock-issuer-keygen.mjs <new-path-outside-repository>`. This also writes `<key-path>.keys.json`. Build a fresh bundle with `node server.mjs bundle <new-directory-outside-repository> --issuer-public-keys <key-path>.keys.json`; this pins the test issuer key inside the bundle manifest and also writes `<new-directory>.tar`. Configure `PUBLIC_MOCK_SELFHOST_BUNDLE_FILE` to that archive. The archive contains the same hash manifest as the extracted directory. The test issuer key must never be reused for production licenses.

The simulation is deliberately separate from production payment events. It must not be enabled on a public production site or used with real vault credentials. A later payment adapter must authenticate the customer, verify the provider's signed event server-side, reconcile the order, and only then release an approved artifact and entitlement. The current test archive has manifest hashes but is not an approved signed public release. It has no distributed rate limiter, key rotation, live billing recovery, or payment reconciliation.

The opt-in simulation now also exposes `customer-account.html` and `/api/customer/*` for email-code customer sign-in, linked order listing, and order reopening. The customer session is a 12-hour Secure, HttpOnly, SameSite=Strict cookie. It is separate from every vault account and never receives a vault secret. Orders support idempotent one-year simulated renewal, replacement to a new installation ID, an old-installation revocation file, and explicit erasure. Replacement cannot reach an offline or lost old server; the old license remains usable there until its revocation file is installed. These are test flows and do not prove production entitlement control.

Order and account data are encrypted at rest with domain-separated keys derived from the intake key. Pending test orders are pruned after 30 days, licensed test orders 90 days after their current license expiry, unverified customer records after one day, and verified customer records after one year since last sign-in. The scheduled cleanup runs at startup and daily. The customer can erase their account and linked test orders through the account page; this does not remove an installed license. Hashed request-limit records persist across process restarts and are pruned after 48 hours. Run one intake instance against a data directory; the file store is not a distributed rate limiter. A public reverse proxy still needs IP-aware edge abuse controls and monitored SMTP.

Filesystem locks are never reclaimed based on age: a slow live operation may still
commit. A busy record fails closed. After a crash, stop the intake process and
confirm that no process is using its data directory before removing orphaned
`.lock` directories. Restart only after that offline maintenance is complete.

The standalone waitlist uses a separate encrypted append-only file and is not covered by customer-account erasure. When unpaid trials are enabled, its contact rows are available through the operator inbox and support erasure and 90-day retention. Legal privacy review, key rotation and off-host recovery remain general launch gates. Do not enable the mock service on a public production site.

# Public waitlist intake (experimental)

This is a separate HTTP API intended to sit behind a reviewed HTTPS reverse proxy at the public website's origin. The static website sends `GET` and `POST` requests to `/api/waitlist`. `npx serve` serves only the static pages, so the form stays disabled in that preview.

The API accepts contact email, intended plan, optional organization, and consent. It writes encrypted JSON Lines records with AES-256-GCM. It does not create a vault user, customer account, purchase, or license. It never asks for vault credentials.

For a disposable local test, set `PUBLIC_INTAKE_ORIGIN` to the exact HTTPS website origin, `PUBLIC_INTAKE_KEY_FILE` to a protected file containing a 64-character random hex key, and `PUBLIC_INTAKE_DATA_FILE` to an absolute path for the encrypted records. `PUBLIC_INTAKE_PORT` defaults to 3101. Run `node apps/public-intake/src/server.mjs`; it binds to loopback only. A reverse proxy must terminate HTTPS and route `/api/waitlist` to it. Do not expose this process directly to the Internet.

Before production, add durable abuse controls, key rotation and recovery, export/deletion tooling, backup/retention policy, privacy notice and consent records, monitored mail delivery, and deployment review. These are release gates, not optional operations tasks.

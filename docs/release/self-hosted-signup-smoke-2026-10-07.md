# Self-hosted signup rehearsal — 2026-10-07

Scope: a fresh Windows 11/Podman test installation, fictitious owner and vault data, and a disposable Ed25519 test issuer. No customer payment, public publication, real SMTP delivery, or browser acceptance was exercised.

1. `node server.mjs bundle C:\Projects\127Vaults-selfhost-smoke-20261007` built the server image and wrote an 832,834,560-byte `.tar` archive. Its manifest recorded revision `5f14657` and `sourceDirty: false`; the archive listed the new `lib/license-files.mjs` and `lib/license-status.mjs` files.
2. In the bundle directory, `install init` generated a fresh private CA and installation identity. The first `install start` stalled through the default Windows Docker Compose shim and was interrupted. A temporary `podman-compose` 1.6.0 provider installed outside the repository allowed `install start` to complete. The installer now refuses Windows/Podman Compose actions without an explicit provider path.
3. `install identify` returned one installation ID. An offline test issuer generated a Personal, five-user, sequence-one license bound to that ID. `install license` verified and stored it; `install start` recreated the server with the license paths. `healthcheck` exited successfully.
4. `scripts/live-mvp-acceptance.mjs` consumed a one-time bootstrap token and passed fictitious owner enrollment, login, invitation creation, private vault creation, item encryption/read/update, concurrent write behavior, and lock checks.
5. `scripts/live-license-acceptance.mjs` authenticated as that fictitious owner and observed `{mode:"active", plan:"personal", enforcement:"disabled"}` from `/api/v1/license`.
6. `install stop` completed without deleting the database volume. `podman ps` showed no remaining running containers. The generated bundle, test identity, test license, temporary provider, and stopped volume were retained outside the repository for inspection.

The mock public-order API has automated coverage for origin checks, email verification, mock commitment selection, authenticated archive download, one-installation license binding, replay rejection, and email recovery. A browser test with live SMTP and an HTTPS reverse proxy remains to be done. This evidence does not approve real credentials, public downloads, production license enforcement, or checkout.

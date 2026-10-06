# Rebuilt server bundle smoke — 2026-10-06

Scope: Windows 11, existing Podman machine, fictitious empty installation. This is the SRV-013 P0 rebuilt-bundle smoke only; no browser enrollment, invited user, backup restore, Docker host, or real credentials were tested.

1. `node server.mjs bundle <new directory outside checkout>` completed. It built the pinned Rust/WASM fixture and server image, pulled PostgreSQL 17 and the OpenSSL helper, exported all three OCI archives, and wrote the hash manifest. The manifest records the current Git revision and `sourceDirty: true`, because this review has uncommitted changes.
2. In the extracted bundle, `node server.mjs install init --endpoint 127.0.0.1 --private-dir <new directory outside bundle>` completed with a local CA and separate installation identity.
3. The first `install start` chose the stale Windows `docker-compose.exe` shim and stalled. It was interrupted. Rerunning `node server.mjs install start --compose-provider C:\Projects\127Vaults\.tools\compose\Scripts\podman-compose.exe` succeeded. This exact provider is required on this host; the install runbook already documents the option.
4. `install status` showed PostgreSQL 17 healthy and the server starting on `127.0.0.1:12780`. `curl.exe --ssl-no-revoke --cacert <test CA> https://127.0.0.1:12780/` returned HTTP 200 with TLS verification result 0. `--ssl-no-revoke` suppresses Schannel's unavailable revocation check for this private test CA; it does not disable chain or hostname verification.
5. `install stop --compose-provider <same path>` succeeded without `--volumes`. The disposable project was `vaults-test-a3842b11ce7a`; its volume and identity were retained in the operator's temp area for inspection.

Outcome: the rebuilt source-to-bundle, isolated init, container start, verified private HTTPS, status, and stop path passed on this existing Windows/Podman host. SRV-013 remains Partial for clean-host/restore work and the other operator gates remain open.

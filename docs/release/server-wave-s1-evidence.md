# Server wave S1 evidence

Date: 2026-10-02. Scope: disposable data, local Windows 11/Podman machine, PostgreSQL 17, Node 24. No user-selected real credential was handled.

## Results

- Existing acceptance database was preserved. Its stopped container initially lacked the mounted password file; `pnpm mvp:start` recreated runtime secrets and started the same volume. No reset or volume deletion occurred.
- `server-data.mjs backup` took a custom-format PostgreSQL dump, sealed it with an independent 32-byte key and verified the envelope. `rehearse` restored it in a new unpublished PostgreSQL container and checked installation/schema/account/item invariants. The preserved acceptance data had schema 3, one account and seven encrypted item rows.
- `migration-rehearsal.mjs` created an isolated schema-1 database, verified an encrypted pre-upgrade backup and its clean restore, ran dry runs and migrations 1→2→3, refused a contended advisory lock within five seconds, and refused an altered manifest. The final schema-3 checksum was `77c1bc667ceac8fc1d048e3fc99c60f123dd5a90fa711b15ce5cd1767bb477db`.
- An offline OCI bundle was loaded into a separate Podman project. Certificate and runtime identity generation, non-root/read-only containers, private PostgreSQL network, HTTPS liveness and authenticated readiness all worked. Stop/start preserved the installation ID. A fresh bundle owner ceremony and encrypted vault/item acceptance passed after updating the live script to supply signed item operations. TLS rejected wrong Host and SNI.
- The bundle's encrypted backup and isolated restore passed on an empty schema-3 installation. Certificate renewal preserved the CA and retained the prior leaf certificate.
- A separate encrypted installation-identity backup was created and restored to a new Windows directory. CA key/cert, leaf key/cert, token key, checkpoint key, database password and readiness token matched byte-for-byte; the restored directory received a restricted operator/System/Administrators ACL.
- A combined restore was then completed into a second Compose project and new database volume. The original project was stopped without deleting its volume. The restored installation ID matched `465e954c-dc1a-4da4-92b1-24ad76c9a1c4`; the previously enrolled fictitious owner completed OPAQUE/device-proof login and listed one vault and one item through the restored HTTPS server.
- A second restore-mode project refused to start its server while the new database was empty. After importing the matching dump, its installation-ID guard passed and the same enrolled owner authenticated and listed the vault/item. Only the newly created database container ran during the initial refusal.
- Stopping the restored PostgreSQL container made authenticated readiness return 503. Starting the same container returned readiness to 200, and the same owner could authenticate and list the vault/item again. No database volume was removed.
- Server tests: 56 passed, one skipped. Rust workspace tests passed. `pnpm audit --prod --audit-level high` found no known production JavaScript vulnerabilities. `cargo audit` found one `rustls` advisory; the lockfile was upgraded from 0.23.44 to 0.23.45, after which it reported no vulnerabilities and seven warnings from other dependencies (principally desktop platform transitive crates). The Rust workspace tests passed after the update.

## Limits

- Podman was exercised on this development computer. Docker Engine, a genuinely unrelated clean host, private-LAN client certificate trust, live external SMTP egress and browser UI ceremony on the test bundle have not been accepted.
- The combined restored copy passed a scripted authenticated owner read and database outage/reconnect test, but a graphical browser ceremony on another host and full rollback after an application upgrade remain open. Upgrade with a populated pre-v3 schema remains open.
- The OCI bundle has SHA-256 file hashes but no signature, immutable registry digest policy or public distribution license. Base-image tags still need reviewed digest pinning.
- Real credential storage, even low-consequence test credentials, remains an experimental risk decision pending independent cryptographic/application review and the [server backlog](../product/server-backlog.md).

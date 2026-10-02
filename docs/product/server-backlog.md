# Server backlog

Updated 2026-10-02. The server is an **experimental internal MVP backend**. A local test bundle, backup/restore and migration rehearsals now exist; see [S1 evidence](../release/server-wave-s1-evidence.md). It is not ready for a supported real-credential first release or public beta.

| ID | State | Outcome and acceptance |
| --- | --- | --- |
| SRV-001 | Done | Private HTTPS/Host/Origin boundary, PostgreSQL schema checks, owner/invite onboarding, OPAQUE sessions, device enrollment/lifecycle, encrypted private-vault routes and signed operation/checkpoint routes are mounted. Source: `apps/server/src/main.mjs`. |
| SRV-002 | Partial | Isolated 1→2→3 migration, encrypted pre-backup/restore, dry run, lock timeout and unknown-checksum refusal passed. Finish populated old-schema upgrade, authenticated rollback and clean-host procedure. |
| SRV-003 | Partial | Automated encrypted database and identity backups passed; a second project restored both and authenticated an existing owner to read vault/item projections. Finish scripted guarded combined restore, off-host key custody and scheduled backup policy. |
| SRV-004 | Partial | Unit tests and live owner encrypted-item/idempotency/race flow pass. Finish live device rotation/revocation, multi-device forks, rate limits and cross-account matrix. |
| SRV-005 | Partial | Podman image is non-root/read-only with private PostgreSQL, loopback HTTPS and persistent volume; stop/start passed. Verify Docker, clean unrelated host, private LAN, safe shutdown under load and upgrade. |
| SRV-006 | Partial | Bounded request telemetry, authenticated readiness metrics, CA-preserving certificate renewal, PostgreSQL outage/reconnect and hostile-input log inspection passed. Finish incident operation on a second host. |
| SRV-007 | Open | Freeze crypto/protocol formats, compatibility rules and deterministic vectors; obtain independent review for real-secret use. |
| SRV-008 | Partial | Production pnpm audit found no known vulnerabilities; `rustls` advisory fixed in `Cargo.lock`. A focused scan found development secrets in tracked `.env` from the initial local snapshot. Rotate/sanitize before publication; finish seven Rust warning triage, image digest pinning, full secret/history scan, signing, legal terms and public release gate. |
| SRV-009 | Open | Prove optional external SMTP-over-TLS egress and invited-user activation on the test bundle; keep password in a mounted secret file and PostgreSQL off the egress network. |
| SRV-010 | Open | Run bundle on an unrelated Podman and Docker host, including CA trust, browser owner ceremony, LAN firewall, backup/restore and client reconnect. |
| SRV-011 | Partial | [Pilot gate](../release/selected-real-data-pilot.md) is defined. Accept it only after intended-host browser/restore/device tests, independent crypto/application review, controlled data selection and a rotation/deletion plan. |
| SRV-012 | Open | Make client evaluation self-service only after installer UX, CA trust, signed artifact verification, backup/key setup and safe upgrade/rollback can be guided and tested without a developer present. Current bundle is operator-led. |

Server readiness has three distinct levels: **internal MVP backend** means the narrow fictitious-data flow works; **first release** requires a supported installation and restore path; **public beta for real secrets** additionally requires the security and legal gates. Only the first level is evidenced today.

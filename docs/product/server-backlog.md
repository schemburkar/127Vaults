# Server backlog

Updated 2026-10-02. The server is an **experimental internal MVP backend** for fictitious data. It is not ready for a public beta or first release.

| ID | State | Outcome and acceptance |
| --- | --- | --- |
| SRV-001 | Done | Private HTTPS/Host/Origin boundary, PostgreSQL schema checks, owner/invite onboarding, OPAQUE sessions, device enrollment/lifecycle, encrypted private-vault routes and signed operation/checkpoint routes are mounted. Source: `apps/server/src/main.mjs`. |
| SRV-002 | Partial | Schema v3 and migration code exist; prove supported upgrades, pre-migration backup, lock contention, incompatible-schema refusal and rollback rehearsal on a clean host. |
| SRV-003 | Open | Automate and rehearse encrypted backup, clean restore and operator recovery; keep database and backup keys separate. |
| SRV-004 | Open | Complete adversarial auth/device/sync tests for replay, rollback, forks, rotation, revocation, expiry, rate limits and cross-account isolation at the live HTTP/PostgreSQL boundary. |
| SRV-005 | Open | Prove deployment hardening on supported Podman and Docker hosts: non-root/read-only image, private network binding, persistent volume, secret injection, safe shutdown and upgrades. |
| SRV-006 | Open | Finish operational metrics, structured redacted logs, certificate renewal and incident/restore instructions; exercise failure modes. |
| SRV-007 | Open | Freeze crypto/protocol formats, compatibility rules and deterministic vectors; obtain independent review for real-secret use. |
| SRV-008 | Open | Complete release provenance, dependency/secret/license scans, legal terms and public release gate in [beta readiness](../release/beta-readiness.md). |

Server readiness has three distinct levels: **internal MVP backend** means the narrow fictitious-data flow works; **first release** requires a supported installation and restore path; **public beta for real secrets** additionally requires the security and legal gates. Only the first level is evidenced today.

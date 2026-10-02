# Accepted MVP decisions

All six proposals accepted on 2026-09-08. Implementation resumes in a later
session; these decisions preserve the wider backlog.

| Decision | Accepted scope | Canonical owner |
| --- | --- | --- |
| Internal MVP | Online web, first owner and one invited test user, private vaults, login items, real authentication and encrypted persistence; fictitious data | [MVP plan](mvp-plan.md) |
| First owner | Locally retrieved, single-use setup secret; atomic consumption with owner creation | [ADR-0015](../adr/0015-account-onboarding-and-sessions.md) |
| Browser identity | Encrypted software-protected identity; both credentials each unlocked session; no retained account secret or hardware claim | [Web boundary](../security/web-client-boundary.md) |
| Private HTTPS | Loopback plus one private-LAN setup using a manually trusted installation-specific local CA | [ADR-0012](../adr/0012-private-network-exposure.md) |
| Item revision | Authenticate the exact index/body pair; retain the last verified version on failure | [Sync protocol](../sync/protocol.md#verified-item-revisions) |
| Email proof | Separate short-lived SMTP verification code; invitation code delivered externally | [ADR-0016](../adr/0016-outbound-security-notifications.md) |

Protocol encodings, OPAQUE/library feasibility, bootstrap/session binding and code
parameters remain engineering work in the [implementation batches](implementation-batches.md).
Review these before dependent durable implementation. Cleared browser storage
requires future enrollment/recovery or an explicit disposable-fixture reset.
SMTP delivery must succeed for invited-account activation; recovery alerts remain
best effort. This MVP does not yet provide a supported household beta.

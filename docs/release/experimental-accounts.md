# Provisional account records — experimental schema 1

This increment stages control-plane identities through a **local operator CLI**.
It does not create usable accounts. Every record is database-constrained to
`enrollment_state=pending` and `email_verified=false`. There is no signup,
invitation redemption, session, password, account-secret, or device endpoint.
The readiness bearer token cannot provision accounts.

## Initialization and changes

Run inside the server container:

```sh
podman exec vaults-experimental_server_1 node apps/server/src/provision.mjs initialize
podman exec vaults-experimental_server_1 node apps/server/src/provision.mjs status
```

Status reports counts, whether provisional bootstrap remains available, and the
next setup step without returning usernames or emails. Invitation counts distinguish
expired and unexpired records; neither count implies a redeemable code exists.
The health endpoints do not require creating an owner. Do not stage an identity
just to make liveness work. Input is limited to 4096 bytes of valid UTF-8.

Initialization takes a transaction-scoped PostgreSQL advisory lock, refuses
non-empty databases, and installs schema version 1 atomically. Repeating it with
the same version/checksum makes no schema changes. Existing or changed schemas
are refused; there is no upgrade engine. Only a genuinely empty database may be
initialized without a backup because it has no application state to preserve.
This narrow empty-database operation does not satisfy ADR-0005's migration gate.

For any existing database needing changes: stop application writes, create a
consistent encrypted backup, prove restore in a separate clean deployment, and
review the migration before applying changes. This procedure is **not implemented
or verified yet**, so this CLI refuses upgrades rather than accepting a backup
filename or a bypass flag as evidence. Never delete a populated database just to
make initialization pass. Disposable development resets must be deliberate.

The schema checksum detects accidental SQL-file drift; it is not protection
against a malicious database operator. Schema version is separate from future
protocol/crypto versions. No cryptographic format is introduced here.

## Stage an owner and invited user

Pipe JSON into the local command; do not include any credentials:

```sh
echo '{"username":"OwnerOne","displayName":"Owner","email":"owner@example.invalid"}' | podman exec -i vaults-experimental_server_1 node apps/server/src/provision.mjs bootstrap-owner
echo '{"username":"GuestOne","displayName":"Guest","email":"guest@example.invalid","expiresInHours":24}' | podman exec -i vaults-experimental_server_1 node apps/server/src/provision.mjs stage-invited-user
```

PowerShell also supports the single-quoted JSON piped to `podman exec -i`.
Use fictitious data only. The first command serializes bootstrap and closes it
after the first account record. The second requires that provisional owner and
always stages an ordinary user plus an invitation record expiring in 24 or 48
hours, measured by PostgreSQL time. This is a record of operator intent, not an
invitation code or a claim that its recipient verified their email. No messages
are sent. Pending records reserve usernames/emails; cancellation and expiry
cleanup are not implemented yet. Expiry does not activate or delete an account.

The provisional username policy is 5–64 ASCII characters: letters, digits or
underscore first, followed by letters, digits, underscore, dot or hyphen.
Casing is preserved with case-insensitive uniqueness within the installation.
Display names allow Unicode. Email is provisionally ASCII and lowercased; this
normalization and the exact username alphabet require final onboarding review.
Unknown JSON fields are rejected, including password, secret, and requested role.

Tables use tenant-scoped UUID identifiers and foreign keys. There is one logical
installation. Server roles contain no vault access. Only one provisional owner
is allowed in this increment; owner updates/deletes and user promotion are refused.
Accepted multi-owner transfers and active-owner lifecycle remain unimplemented.
Database superusers can bypass database protections; runtime/migration database
role separation remains a required follow-up.

## Verification — 2026-09-06

Ad hoc checks against a disposable PostgreSQL database passed: non-empty refusal,
fresh/repeated initialization, concurrent bootstrap (exactly one succeeds),
ordinary invited-user staging, 24/48-hour expiry selection, invalid expiry,
case-insensitive username collision, unknown credential field rejection,
pending/unverified invariants, owner deletion/demotion/promotion refusal, and
changed-checksum refusal. The disposable database was removed afterward.

The development database was initialized with **zero account records**. Readiness
changed from 503 before initialization to 200 with `schemaVersion: 1` afterward.
Unit tests were not added; automated coverage and broader adversarial cases are
tracked in the backlog. No bootstrap identity was invented for the user.

Follow-up smoke checks passed for byte-by-byte Unicode JSON input, exact stored
display-name preservation, malformed UTF-8 refusal, and setup status before/after
provisional owner staging in a disposable database. That database was removed;
the development database still contains zero accounts.

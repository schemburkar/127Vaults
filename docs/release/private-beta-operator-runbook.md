# Private-beta operator runbook (RB5 groundwork)

Status: **groundwork only**. The current build is experimental and must not store
real credentials. This document does not claim that migrations, upgrades, backup
scheduling, or clean-host restore are release-tested.

## Supported boundary

Run on loopback, one explicit private-LAN address, or a future documented
Tailscale adapter. Do not configure public DNS, public port forwarding, wildcard
binds, or a public reverse proxy. PostgreSQL stays on the internal container
network and its named volume is not shared with a second installation.

Record the application revision, compose provider/version, image identifiers,
endpoint, server identity, and certificate fingerprints in the operator log.

## Backup contract and executable envelope tool

The database source is a PostgreSQL custom-format dump produced by the PostgreSQL
17 client. `scripts/ops/backup-envelope.mjs` wraps one dump in the version-1
`127VBAK1` envelope using AES-256-GCM. Its authenticated JSON header records the
format/cipher versions, time, database, server identity, required application
version, plaintext length, and SHA-256 digest. Verification authenticates and
hashes the complete plaintext without retaining a decrypted file.

Create a 32-byte key outside the repository, protect it with OS permissions/ACLs,
and keep a separately controlled recovery copy. Never store the key beside the
backup. The tool accepts 32 raw bytes, 64 hex characters, or canonical base64.

The current safe manual workflow is:

1. Confirm application/database health and adequate free space. Do not remove or
   recreate the current volume.
2. Use `pg_dump --format=custom --no-owner --no-acl` from the pinned PostgreSQL 17
   tooling to create a temporary dump. Supply credentials without putting them on
   the command line. This command is deployment-provider-specific and is not yet
   automated.
3. Seal it to a new path (the tool refuses overwrite):

   ```text
   node scripts/ops/backup-envelope.mjs seal --input <dump> --output <off-host.127vbak> --key-file <key> --database vaults_experimental --server-id <installation-id> --required-version <revision>
   ```

4. Verify the off-host copy, then securely remove the temporary plaintext using
   an operator-approved method appropriate to its filesystem:

   ```text
   node scripts/ops/backup-envelope.mjs verify --input <off-host.127vbak> --key-file <key>
   ```

Encryption does not prove database consistency. `pg_dump` supplies a transactionally
consistent logical snapshot; a successful envelope check proves only authenticity
and completeness of the captured dump.

## Clean restore verification

Restore only into a new, isolated compose project with a new empty PostgreSQL
volume and no published server port. Never test by restoring over the production
volume. Record backup header and image/application versions first.

1. Open the envelope to a newly created temporary path:

   ```text
   node scripts/ops/backup-envelope.mjs open --input <backup.127vbak> --output <restore.dump> --key-file <key>
   ```

2. Start the isolated target database. Prove it is the intended project and that
   it has no application tables. Stop if either check fails.
3. Run PostgreSQL 17 `pg_restore --exit-on-error --single-transaction --no-owner
   --no-acl` against only that empty target.
4. Start the matching application revision without external publication. Run
   schema/migration checks, health checks, row-count invariants, and authenticated
   application acceptance when those RB2/RB3 checks exist.
5. Destroy only the explicitly named disposable restore project after recording
   results. Securely remove the plaintext restore dump.

The repository currently supplies steps 1 and envelope verification. Empty-target
proof, schema-aware invariants, and a disposable compose restore harness are
planned after RB2/RB3 finalize the schema.

## Certificate renewal

Before expiry, record the live certificate fingerprint and dates. With the same
endpoint and protected TLS directory, run:

```text
pnpm tls:renew -- <localhost-or-literal-private-IP> <absolute-private-TLS-directory>
```

The helper creates and validates a pending key/certificate pair before replacing
`live`; the prior pair is retained under `previous`. Restart the server container
so it reopens the mounted files, confirm health through the exact configured
authority, and compare the served fingerprint/SAN/expiry with `live/server.crt`.
Clients continue trusting the same local CA. If the CA key is lost or compromised,
do not treat this as renewal: create a new CA under an incident procedure, verify
its fingerprint out of band, explicitly replace client trust, and revoke/remove
the old trust where each platform permits it.

## Emergency access

Emergency access means host/database recovery by authorized operators; it does
not provide vault plaintext or bypass client cryptography.

1. Isolate the host from unapproved networks while retaining console access.
2. Preserve logs, image IDs, configuration hashes, timestamps, and an encrypted
   database backup before making changes, when safe.
3. Rotate exposed database, runtime token, backup, and TLS material independently.
   Revoke devices/sessions using RB3 procedures once implemented.
4. Restore into a new isolated instance; do not mutate the only surviving volume.
5. Require two-person review for recovery-key use and record custody without
   recording secrets. Return service only after integrity and application checks.

There is no standing administrator plaintext path, universal recovery credential,
or supported authentication bypass. If all authorized client/recovery keys are
lost, encrypted vault content may be unrecoverable by design.

## Upgrade and rollback gate (planned)

No upgrade is approved until the target release documents schema compatibility,
ships tested forward migrations, verifies a pre-migration encrypted backup, and
passes a clean restore rehearsal. Rollback means restoring the pre-upgrade backup
into a fresh instance running its matching prior application version—not running
old code against a migrated database. Exact commands await the finalized RB2/RB3
schema and migration runner.

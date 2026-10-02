# Schema 2 migration evidence

Status: persistence foundation only; still prohibited for real private-beta data.

Schema 1 remains frozen at SHA-256
`1cb04ec65b704943dffa1c0af9086f1a5baa0327f5719cb28fa307c1a06f3c02`.
Schema 2 is a reproducible recipe consisting of that exact schema-1 source plus
`apps/server/src/schema-v2-migration.sql`; its manifest checksum covers both.

Fresh initialization applies the same schema-1 source and schema-2 DDL in one
provisioning transaction. Existing installations require the explicit
`pnpm --filter @127vaults/server schema -- status`,
`pnpm --filter @127vaults/server schema -- dry-run`, and
`pnpm --filter @127vaults/server schema -- apply` paths. Startup never migrates. The apply path verifies
the known version/checksum under the provisioning advisory transaction lock,
captures protected row counts, performs all DDL/backfills, checks lifecycle/FK
invariants, and updates the version/checksum as its final write. Legacy `active`
is replaced by a status-derived generated compatibility column. Any failure rolls
the transaction back. A committed migration is recovered by restoring the
operator's pre-migration database copy, not reverse DDL.

Schema 2 durably adds account/session epochs and recovery state, device lifecycle
and credential status, public session IDs, enrollments, recoveries and lifecycle
audit. It also adds per-vault sync state, per-device heads, typed signed operations
and append-only signed checkpoints. Fixed-size public keys, IDs, hashes and
signatures have byte-length checks; states and operation kinds are constrained;
tenant-scoped ownership uses foreign keys; operation IDs are unique per vault for
idempotency. Existing devices are backfilled active/current and existing vaults
receive genesis sync state.

This does not implement lifecycle or sync transactions, HTTP routes, conflict
materialization, compaction, operator backup automation, or client support.
Migration must first be exercised against a disposable restored copy. No command
in this work applies schema 2 to the currently running PostgreSQL volume.

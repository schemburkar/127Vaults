# Regional shared Cloud tenancy

Status: architecture decision and implementation contract; an isolated internal Cloud scaffold exists, but the customer service is not complete or approved for launch.

First deployment decision (2026-10-06): use one shared Cloud deployment. The internal database location key is `global`; users do not choose a region, and no Asia/Europe infrastructure or region discovery is required for this cut. The key remains internal so a future move to multiple locations can be a reviewed migration. `global` makes no data-residency claim. Each Cloud tenant may contain multiple accounts. Account IDs, usernames, and email uniqueness are tenant-scoped, so one email may be enrolled independently in two tenants; a global person identity is deferred.

Commercial model (2026-10-06): every Cloud tenant has the same $30 per licensed vault user per year, annual upfront, two-year commitment. Individuals, families, and companies use the same tenant type and can add seats without a plan conversion. The tenant control owner is a separate verified public/customer identity; it can administer billing and seats without a vault account and consumes no seat. A vault account consumes a seat even when its email matches the control owner's. The internal catalog records the control owner identity ID and email, but public identity verification and authorization remain to be implemented. Tenant activation requires a linked control owner and a first enrolled vault owner account. A service pause does not cancel the two-year commitment; exact access and billing behavior during pause is still to be specified.

The [Cloud family pilot backlog](cloud-family-pilot-backlog.md) tracks the single-location deployment and browser-based operator workflow. `apps/server/internal-cloud/` contains the schema overlay, tenant provisioning functions, HTTPS listener, request boundaries, and handler composition. The disposable PostgreSQL rehearsal verifies four tenants, fixed seat enforcement, first-owner and invited-user enrollment, and cross-host HTTPS rejection. It uses a stub for OPAQUE. The internal Cloud image packages the real OPAQUE bridge. The shared Rust client pins tenant ID with origin and server identity after online unlock. The self-hosted image excludes internal Cloud code and rejects Cloud mode and the Cloud schema.

## Product boundary

127Vaults Cloud uses shared application and database infrastructure within each supported region. Ordinary Cloud customers and organizations are tenants of a regional service. Cloud does not offer a dedicated container, database, or cluster tier. A customer requiring infrastructure isolation can self-host, or contract for an operator-managed deployment in infrastructure owned and paid for by that customer. That deployment uses the self-hosted installation model and is not a Cloud tenant or a bypass of Cloud isolation rules.

Each tenant has one immutable UUID and one authoritative home region. Tenant ID is a cryptographic and authorization identity; a hostname, email, display name, billing ID, and region are not substitutes. Preserve tenant ID across permitted moves and restores. One region has one transactional write authority for a tenant. Active-active cross-region writing remains out of scope, consistent with [sync protocol](../sync/protocol.md).

## Regional topology and database

- Run multiple stateless API/sync replicas per region behind a trusted HTTPS ingress, with a regional PostgreSQL primary and suitable standby/backup infrastructure. Replicas may handle any tenant in that region.
- Use a regional tenant directory/control plane for tenant ID, canonical origin, lifecycle state, and home region. Define its availability, authorization, audit, and recovery model before use. Regional data stores must reject tenants whose home region differs. Do not follow client-supplied region or tenant IDs as authority.
- Store ordinary Cloud tenant records in shared PostgreSQL tables keyed by `tenant_id`. Keep composite tenant-scoped primary/foreign keys and uniqueness rules. Audit every table, index, trigger, function, view, background job, and new migration for tenant scope. Global tables require an explicit access policy.
- Add PostgreSQL row-level security to tenant data as a second boundary. The runtime role must not own protected tables, have `BYPASSRLS`, or use a superuser connection. Set tenant context transaction-locally from verified request state; fail closed when absent, and prove that pooled connections cannot carry context into the next request. Administrative/migration roles are separate, narrowly accessed, and audited. RLS does not replace application authorization.
- Define regional capacity, per-tenant quotas, rate limits, fairness, storage limits, and alerts so one tenant cannot exhaust shared service resources.

## Request identity and authorization

1. Verify the canonical Cloud origin at ingress. The pilot uses one hostname, `cloud.127vaults.com`, with `/t/<slug>/` selecting the tenant. Reject unknown or mismatched Host, SNI, Origin, and proxy metadata. Specify exactly which proxy headers are accepted and which ingress identity authenticates them. Existing private-LAN transport rules remain a separate mode.
2. Resolve tenant before password/authentication lookup. Bind OPAQUE setup, login transcript, device enrollment, invitations, sessions, CSRF, recovery, and email links to the resolved tenant and canonical origin. A user may belong to multiple tenants; membership and account IDs are tenant-scoped. Never infer a tenant solely from an email address or accept a tenant ID supplied by a client as authorization.
3. On every authenticated request, verify that route tenant, session tenant, account/device membership, and signed/encrypted payload tenant match. Return a uniform rejection on mismatch. Background jobs and support tools need the same explicit tenant context.
4. Preserve tenant binding in encrypted envelopes, signed operations, checkpoints, cursors, and local replicas. Specify how checkpoint signing keys are distributed and rotated in a regional service without changing the meaning of existing installation identity.

The current `vaults.installation` singleton, single startup OPAQUE setup, fixed origin, owner bootstrap, and installation-level signing keys cannot simply become a shared Cloud tenant directory. Design a versioned Cloud identity/metadata model and migration; retain the installation path for self-hosting. Avoid silently reinterpreting old installation IDs or ciphertext context.

## Client and API contract

- Publish a versioned, unauthenticated discovery response under the canonical tenant URL. Return its full URL and HTTPS origin separately, with region, tenant UUID, supported protocol versions and server keys. Clients verify HTTPS and pin the tenant and keys. Discovery contains no private account or vault information.
- The web app uses same-origin tenant paths for login and API calls. Cloud paths share host-only cookies, so each API resolves the path to a UUID before looking up a session or verifying a tenant-signed ceremony. Browser identity and replica keys include the tenant UUID. Switching tenant paths locks the previous tenant across tabs. The shell cache is scoped to its path and contains no tenant API data.
- Desktop and CLI enrollment record canonical origin, tenant UUID, region, trust material, and account/device identity. Local replicas, pending operations, cursors, checkpoints, and credential stores are keyed by tenant and origin. Switching tenants locks the current vault and does not merge local state. A region move requires an explicit, authenticated trust transition with checkpoint continuity, not an automatic URL rewrite.
- Browser extension/autofill must derive its active vault from the authenticated client context and keep site matching separate from the Cloud tenant hostname. Tenant switching clears authorization and fill state.
- Version API/auth/sync contracts for Cloud discovery and tenant mismatch responses. Compatibility tests must cover old self-hosted clients, supported Cloud clients, and protocol upgrade/downgrade refusal.

## Provision, restore, move, and deletion

- Provision tenant metadata, region assignment, identity/auth setup, initial owner enrollment, quotas, and billing entitlement as an idempotent state machine. Partial failure must leave no active, half-provisioned tenant. Cloud owner enrollment is distinct from host-local bootstrap.
- Maintain encrypted, region-bound whole-database backups for disaster recovery. Document retention, replication destination, key custody, recovery point/time objectives, and a rehearsed regional restore. Database restore alone is insufficient where installation/tenant identity and signing material live elsewhere.
- Design tenant-selective recovery separately: restore a regional backup into an isolated recovery environment, extract exactly one tenant and all dependent encrypted records/metadata, verify referential and cryptographic continuity, then import under a fenced tenant state. Specify collisions, existing sessions, pending client writes, idempotency, audit, and rollback. Never overwrite a live tenant from a regional backup without a tested ceremony.
- Region moves require a write fence, complete tenant export/import, identity and checkpoint continuity, client discovery transition, and rollback plan. No background cross-region write replication is assumed.
- Deletion covers live rows, derived data, jobs, search/telemetry metadata, exported objects, credentials, and the documented backup-retention window. Make cancellation, legal holds, irreversible purge, and proof/audit of completion explicit. Deletion must not erase another tenant's data.
- Operator-managed customer infrastructure follows self-hosted backup, restore, upgrade, and deletion procedures under a separate contract and credentials.

## Implementation order and launch gates

1. Freeze the identity/discovery, origin, and client trust contracts, including backward compatibility for existing self-hosted installations.
2. Add Cloud tenant directory and provisioning lifecycle; replace singleton assumptions in Cloud-mode startup, authentication, onboarding, admin, licensing, and signing. Keep private-installation behavior covered by regression tests.
3. Complete schema audit, scoped data access, RLS/runtime-role separation, transaction-local context, and isolation tests across HTTP handlers, background jobs, and migrations.
4. Implement web, desktop, CLI, and extension tenant selection, trust, local-state partitioning, and mismatch handling.
5. Implement regional backup rehearsal, tenant-selective restore, lifecycle deletion, incident procedures, observability, and capacity controls.

Internal Cloud work is kept out of the self-hosted OCI image and installer bundle. Its operator CLI is not a customer feature. No Cloud activation or customer sign-up command is available while the regional runtime and restore gates remain open.

Release requires automated two-tenant tests that deliberately swap host, session, account, device, payload, cursor, checkpoint, and local replica identity; direct runtime-role SQL probes; connection-pool reuse tests; concurrent provisioning; tenant-selective restore and deletion rehearsals; region-failure drills; and self-hosted regression tests. Treat any cross-tenant read, write, enumeration, or restore as a release blocker. Record evidence against this checklist before exposing Cloud sign-up.

## Decisions still requiring exact specifications

- Regional domain and tenant discovery format; custom-domain policy.
- Cloud OPAQUE setup and checkpoint signing-key scope, rotation, and client trust migration.
- Whether household/organization membership shares an existing account namespace or needs a new account-membership model.
- Backup retention, restore objectives, deletion deadlines, and cross-region disaster-recovery locations per region.
- Exact Cloud billing/control-plane ownership and the boundary to customer-owned managed self-hosting.

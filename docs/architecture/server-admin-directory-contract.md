# Local operator directory API

The experimental `/api/admin/` routes use the separate local operator session described in [server administration](../product/server-admin.md). They are loopback-deployment-only. Both configured operator roles can inspect these directories; no vault-account session or vault keys are involved. An unauthenticated or expired operator cookie receives `401 admin_auth_required`. All JSON responses use `Cache-Control: no-store`.

## Directory routes

`GET /api/admin/users`, `GET /api/admin/devices` and `GET /api/admin/invitations` accept the following query parameters. Unrecognized or duplicate parameters, invalid filter values and out-of-bounds numbers return `400 invalid_directory_query` before any database query.

| Parameter | Routes | Meaning |
| --- | --- | --- |
| `q` | All | Trimmed, case-insensitive literal substring, up to 120 characters. SQL wildcard characters have no special meaning. Embedded control characters are rejected. |
| `page` | All | Positive integer up to 1,000,000; default 1. A page beyond the last page is clamped to the last page. |
| `pageSize` | All | Positive integer up to 100; default 25. |
| `sort` | Users | `newest` (default), `oldest` or `username` (ascending). |
| `sort` | Devices | `newest` (default), `oldest` or `account` (ascending username). |
| `sort` | Invitations | `newest` (default), `oldest`, `expires` (soonest first) or `email` (ascending). |
| `status` | Users | `pending` or `active`. |
| `role` | Users | `owner`, `user` or `admin`; current vault-account schema supports owner/user only. |
| `status` | Devices | `pending`, `active`, `revoked` or `replaced`. |
| `protection` | Devices | `unknown`, `software`, `platform` or `hardware`. |
| `credential` | Devices | `current`, `rotation_required` or `stale`. |
| `accountId` | Devices | Account ID to scope the inventory; bounded to 128 ASCII alphanumeric/hyphen characters. |
| `status` | Invitations | `pending`, `expired`, `revoked` or `redeemed`. |

Blank text/enum filters mean all records. Searches cover account display name, username, email and ID for users; device ID and account display name/username for devices; recipient email, inviter username and invitation record ID for invitations. Every search/filter value is bound as a PostgreSQL parameter.

Each response contains its named array (`users`, `devices` or `invitations`) and `total`, `page`, `pageSize`, `pageCount`, `hasPrevious` and `hasNext`. An empty result has `total: 0`, `page: 1`, `pageCount: 1` and no previous/next page. Sorting uses allowlisted SQL fragments with stable identity tie-breakers. Counts and rows share one read-only repeatable-read transaction, so concurrent lifecycle changes or invitation expiry cannot produce contradictory counts within a response. New requests may see newer data. A failed rollback discards the connection before it can return to the pool.

## Returned metadata

- Users: `id`, `username`, `displayName`, `email`, `role`, `status`, `emailVerified`, `createdAt`, `deviceCount`. Device counts include only active devices belonging to the same account and tenant.
- Devices: `id`, `accountId`, `username`, `displayName`, `status`, `protection`, `credentialState`, `createdAt`, `revokedAt`. Protection is reported metadata, not a fresh attestation result.
- Invitations: one row per recipient with `id`, `email`, `createdBy` (username), `status`, `createdAt`, `expiresAt`, `revokedAt`, `redeemedAt`. A redeemed recipient remains `redeemed`; otherwise a revoked record is `revoked`, then an expired record is `expired`, and the remainder is `pending`. The invitation ID may therefore occur in multiple rows with different recipient emails or statuses.

No response selects or serializes invitation token digests, activation links, email verification codes, onboarding candidates, device signing keys, authentication records, vault metadata or ciphertext. The invitation directory reports persisted reservation/enrollment state; it does not report SMTP delivery or whether a recipient has started an uncommitted onboarding attempt.

Database failures return `503 admin_data_unavailable` without internal details. Non-GET directory requests return `405 read_only`. Existing sign-in Origin checks, Secure/HttpOnly/SameSite cookies, session expiry and CSRF-protected sign-out apply unchanged.

Failed sign-in responses include `Retry-After` seconds for the current source cooldown, as do rate-limited attempts. The console honors bounded delays of up to 60 seconds. Observed expired operator sessions are removed from memory; subsequent successful sign-in also prunes expired sessions. The console validates response shape before rendering and requires `signedOut: true` before treating an HTTP-success sign-out response as confirmed.

`GET /api/admin/overview` additionally reports `devices.rotationRequired`, `devices.stale` and `devices.unknownProtection` for active devices only, plus `invitations.pending` and `invitations.expired` for unredeemed, unrevoked recipients. These counts drive read-only review links with matching directory filters. They are not license-seat totals, device attestations, or SMTP-delivery reports.

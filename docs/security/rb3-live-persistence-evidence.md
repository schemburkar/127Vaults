# RB3 live-persistence candidate evidence

Status: implementation candidate; **not approved for real secrets**.

`PgDeviceLifecycleStore` provides PostgreSQL transaction boundaries for device
listing, enrollment begin/consume, revocation, password credential rotation, and
account-secret rotation. Enrollment stores only a SHA-256 digest of the random
single-use code. Approval locks the enrollment and account rows, uses the server
clock for expiry, checks the credential epoch and exact approving session, and
verifies both Ed25519 signatures before consuming it. Device revocation increments
the authorization epoch and revokes the device's sessions in the same transaction.
Both rotation operations advance account and session epochs and revoke sessions.

`createDeviceLifecycleHandler(store, authenticate, origin)` is the mount contract.
It returns `false` for unrelated paths and otherwise owns `/api/experimental/v1/devices`.
The authenticator result must include `tenantId`, `accountId`, `deviceId`, `sessionId`,
and `csrf`. Existing `PgAuthStore.authenticate` therefore needs to expose the schema-v2
public `sessions.session_id` as `sessionId` when the root composition mounts it.
All identity is taken from that authenticated result, never from request JSON.

The transport exposes GET listing and POST enrollment begin/approve, revoke,
password rotation, and account-secret rotation. Unsafe requests require exact
HTTPS Origin and CSRF agreement. Unexpected storage/cryptographic failures are
reported generically as `UNAVAILABLE`; authentication failures do not reveal
account or device state.

## Deferred recovery boundary

Recovery begin/cancel/complete is deliberately not mounted in this slice. Once
the final device is lost there is no valid ordinary device session, so accepting
caller-controlled `proofVerified`, `ceremonyVerified`, or administrator IDs on
this authenticated handler would violate the reviewed RB3 adapter contract.
The remaining implementation needs a reviewed recovery-capability adapter which
returns a short-lived, purpose-bound, single-use principal for offline-kit proof
or selected-admin approval. That principal must be transactionally consumed with
the `device_recoveries` transition; selected-admin cancellation also needs an
explicit policy-authorized principal. Recovery completion must rotate the account
secret/envelopes, not merely add a device.

The remaining full-RB3 work is: rejected audit records without creating an
oracle, accepted audit rows for approval/revocation/rotations, recovery adapter
and handlers, security notifications, crash-interruption PostgreSQL tests, and
live schema-v2 integration tests.

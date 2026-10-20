# ADR-0004: License state is not key destruction

- Status: Proposed
- Date: 2026-09-06

## Decision

An expired license moves through application states: valid, 30-day read-only
grace, then locked until a valid signed license is installed. Expiry never deletes
or mutates encrypted data, key envelopes, or backups. A valid renewal removes the
licensing restriction for its covered scope; successful data access still requires
intact data, credentials, recovery material and a compatible installation. Renewal
is not a guarantee of indefinite recovery or support.

All supported clients require an installation-bound signed license. Missing,
invalid and revoked entitlements deny vault access; an active license allows
writes, while the 30-day grace allows reads and exports. After grace, the operator
must obtain a signed trial or renewal before access/export resumes. A request
workflow is deferred. Development licenses use the same signature, installation,
seat and expiry checks; there is no machine-name or no-license exemption.

Native clients cache server-verified entitlements encrypted under the account
root, bound to origin and installation. The installed web app also binds its
encrypted cache to the device. A first unlock after upgrade requires online
verification. Connectivity failures can use a valid cached entitlement; TLS,
authentication and verification failures do not grant fallback access. Offline
expiry is evaluated at each operation and the UI checks periodically. Revocation
becomes effective offline when next observed online. A cache cannot establish a
trusted wall clock on a user-controlled offline machine; restoring an entire old
profile and rolling back the OS clock is outside this application-level control.
The server maintains a persistent clock high-water mark. Licensing controls do
not make exported plaintext or old client binaries inaccessible.

Licensing is independent of key derivation and encryption. Offline clock rollback,
server migration, disaster recovery, grace-period persistence, and emergency
export behavior require explicit designs and tests.


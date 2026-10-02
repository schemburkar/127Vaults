# Beta implementation and release readiness

Status reviewed 2026-10-02: the fictitious-data **internal MVP backend and browser flow are implemented**, with final human browser/CA-trust evidence still pending. The CLI and desktop have additional experimental capabilities. The public beta and first supported release remain blocked. Current component status is tracked in the [product work index](../product/README.md); the older implementation-start narrative below is historical.

The server test bundle now has a Podman loopback installation, encrypted backup,
isolated restore and schema migration rehearsal. See the [server wave evidence](server-wave-s1-evidence.md).
This does not close the independent review, Docker/clean-host, SMTP egress,
client restore, release signing, legal or real-credential gates.

## Implementation may begin

The architecture is sufficiently defined to implement a narrow end-to-end slice:

1. containerized server and PostgreSQL;
2. bootstrap owner and invited-user account records;
3. client-side user/vault key hierarchy behind versioned interfaces;
4. one private vault and login item;
5. encrypted create/read/update synchronization;
6. local encrypted replica and 30-minute client lock;
7. one browser profile proving the initial encrypted online persistence/fetch path.

Second-device enrollment and conflict testing follow immediately after the first
slice, but do not block starting that slice.

This slice is architecture validation, not a production password manager.
Temporary cryptographic wire formats must not be silently promoted to stable
formats.

## Public beta remains blocked

Implementation has started with experimental HTTP/PostgreSQL infrastructure.
See [the increment backlog](../product/implementation-backlog.md#first-slice-increments)
and [development instructions](experimental-development.md). Unit tests are
temporarily deferred and tracked in the backlog; this does not waive release
security gates. Provisional account records and empty-database initialization are
implemented; usable onboarding, upgrades, crypto, item, sync, and browser flows
remain pending. See [account increment verification](experimental-accounts.md).
Client-only login-item and idle-lock components now exist; they are not connected
to encryption, authentication, or a browser UI. See
[their boundaries and verification](../security/experimental-client-state.md).

A public beta that invites real secret storage requires, at minimum:

- frozen, versioned cryptographic formats and test vectors;
- reviewed KDF, key wrapping, AEAD, signing, nonce, and randomness choices;
- complete device enrollment, credential rotation, revocation, and recovery
  state machines;
- adversarial sync tests covering replay, rollback, forks, stale snapshots,
  deletion conflicts, membership changes, and idempotency;
- browser-extension isolation and autofill threat analysis if the extension or
  autofill is included/enabled;
- passkey/WebAuthn design appropriate to a password manager if those features
  are included/enabled;
- database migrations, backup/restore drills, and upgrade/rollback policy;
- signed build/update and release provenance;
- dependency, secret, and vulnerability scanning;
- operational documentation and explicit experimental warnings;
- licensing text finalized for the particular beta release;
- independent security review before any claim of production-grade security.

The implementation should therefore use feature gates and experimental labels
until these gates are satisfied.

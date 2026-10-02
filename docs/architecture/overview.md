# Architecture overview

## Trust boundaries

```text
master password + account secret
              |
              v
     trusted client/device
       | encrypt/sign
       v
private network transport ----> untrusted sync server ----> database/backups
       ^                              |
       | opaque ciphertext            | cannot decrypt vaults
       +------------------------------+
```

The transport remains authenticated and encrypted even on a private network.
Tailscale or a tunnel reduces exposure; it is not a substitute for application
authentication, authorization, replay protection, or ciphertext integrity.

Each user owns an independent high-entropy account secret and random user root
key. Supported installed devices protect the account secret locally and can unlock
offline with the master password. The online web MVP uses an encrypted
software-protected browser identity, requires both credentials each unlocked
session and retains no account secret across sessions; it makes no hardware
protection claim. See the [web boundary](../security/web-client-boundary.md).
Password changes rewrap—not re-encrypt—the root key but
require an online atomic authentication update. Account-secret changes also require
a new master password and re-enrollment of every other device.

First-owner creation atomically consumes a locally retrieved single-use setup
secret. Registration is then invite-only; see [onboarding](../adr/0015-account-onboarding-and-sessions.md).
Account authentication
uses layered rate limits, optional TOTP kept outside the account, and server-side
lock state that an admin may clear without changing cryptographic credentials.
Master passwords require at least 20 characters and are checked by default through
the padded HIBP k-anonymity range protocol.

Invites create ordinary users and are delivered outside the product. A separate
short-lived SMTP code verifies the invited email before activation. Recovery and
security alerts use operator SMTP or an optional hosted relay; their delivery is
best effort. See [notification policy](../adr/0016-outbound-security-notifications.md).
Twenty consecutive authentication failures require an audited server-admin
unlock. Lost account MFA may use the four-hour selected-admin recovery ceremony.

The server supports multiple owners but requires at least one. Owner appointment
requires acceptance, and admins cannot remove/demote owners. Server roles remain
cryptographically separate from vault membership and read access.

## Provisional components

- **Crypto core:** key derivation, wrapping, authenticated encryption,
  signatures, serialization, test vectors, and secret types.
- **Sync engine:** local operation log, conflict handling, replay/rollback
  detection, cursor management, and deletion semantics.
- **Server:** accounts, registered device public keys, membership, opaque object
  storage, ordering, quotas, rate limits, audit events, and backup orchestration.
- **Clients:** unlock locally, cache encrypted state, render plaintext only in a
  trusted UI boundary, and authorize new devices.

## Implementation order

Design targets multiple users, devices, private vaults, and shared vaults from the
first schema and protocol version. Usable surfaces are implemented in this order:
web app, browser extension, Windows/Tauri app, then CLI. The Windows app has a
required native-capability spike for cross-process drag-to-fill before Tauri is
considered final.

The server-hosted web client is online-only. Installed desktop, extension, mobile,
and CLI clients are offline-first: they retain an encrypted local database, allow
access without the server after unlock, queue authenticated operations, and sync
when connectivity returns. Offline authorization and revocation staleness require
explicit protocol semantics.

The web client decrypts a lightweight item index for listing and decrypts item
bodies individually on demand. A separately authenticated logical revision binds
the exact index/body envelopes to the expected tenant, vault, item, key epoch and
logical revision from verified state. Incomplete or mismatched pairs cannot replace the last
verified version. [ECF1](../security/experimental-crypto-format.md) remains
experimental; distinct encryption revision IDs do not themselves bind the pair or
prove freshness. Manifest authentication, signing and checkpoints remain later
work; see [verified revisions](../sync/protocol.md#verified-item-revisions).
The trusted-server banner makes clear that this web client cannot defend against
a compromised server serving malicious JavaScript.

Device identities use verified hardware-backed keys when supported. Revocation
stops future sync and may queue a best-effort wipe for compliant reconnecting
clients, but cannot erase an offline or adversarial device. Operators may opt into
a general configurable reconnect reminder; it is disabled by default.

## Deployment defaults

The internal MVP covers loopback and one private-LAN HTTPS setup with a manually
trusted installation-specific local CA. Other private adapters remain later scope;
see [network policy](../adr/0012-private-network-exposure.md).

The server binds to loopback unless an operator explicitly selects one private-LAN,
Tailscale, or Cloudflare-private-connector mode. Direct public exposure, wildcard
binding, generic reverse proxies, and arbitrary DNS host routing are unsupported.
Exact configured hostnames/IP authorities are accepted; all others fail closed.
Cloudflare published-hostname routing is not classified as private because its
edge endpoint is publicly reachable even when the origin has no inbound port.
External DNS pointing a custom domain at 127Vaults does not register it: endpoint
identity comes only from the active local, private-interface, Tailscale, or private
connector adapter and is enforced consistently across TLS, HTTP, browser origins,
WebSockets, and WebAuthn.

## Initial data model (conceptual)

- account / user identity
- device identity, public keys, status, enrollment and revocation timestamps
- vault identity and kind (private/shared)
- vault membership and encrypted per-recipient key envelopes
- encrypted item/object plus authenticated version metadata
- append-only signed sync operation and server ordering cursor
- security audit event containing no vault plaintext

The exact schema follows the threat model and sync protocol, not the reverse.

Shared vaults have reader, writer, manager, and owner roles. Every member can
read; writer access is explicit; manager includes read/write and membership
administration; ownership protects transfer and irreversible actions. Membership
removal advances the vault key epoch so former members cannot decrypt future
updates even if they later obtain ciphertext.

Items use 10-day recoverable trash. Shared-vault deletion first announces a
four-hour read-only period, followed by a 24-hour restore window. History separates
longer-lived metadata-only events from encrypted value snapshots capped at 120
days, while retaining the last 10 password values as a bounded recovery exception.
Metadata history defaults to 90 days and is capped at 365 days. Created-at and
last-edited-at remain as item lifecycle fields until purge.

## Persistence and backups

PostgreSQL is the single server database and normally runs as an OCI container on
a private container network. Database dumps are additionally encrypted before
upload to BYO S3-compatible or Azure storage. Restore supports both server-managed
keys and an offline-key high-security mode.

## Item and optional capability scope

The first item capabilities are login/password, TOTP, and passkeys, followed by
structured security-question fields and notes. Passkeys require a dedicated
WebAuthn/RP/origin and extension-security design; they are not modeled as generic
secret text.

Attachments are excluded from the core server. A later optional attachment
service exposes a versioned capability and storage-provider interface for local,
BYO cloud, or custom storage. Clients must degrade safely when that capability is
absent, and attachment ciphertext uses independent keys and integrity metadata.

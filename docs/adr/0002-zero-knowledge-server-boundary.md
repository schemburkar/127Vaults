# ADR-0002: Zero-knowledge server boundary

- Status: Proposed
- Date: 2026-09-06

## Decision

Vault item plaintext, vault keys, user root keys, device private keys, master
passwords, and account secret keys must never be sent to or recoverable by the
server. The server stores identities, device public material, authorization
metadata, opaque encrypted objects, signed operations, and ordering cursors.

## Consequences

- Search and item interpretation occur on clients.
- Admin status alone cannot grant access to a private vault.
- Sharing requires cryptographic key distribution to authorized members/devices.
- Recovery must be explicit and cryptographic; a server-side password reset is
  not sufficient to recover vault contents.
- Metadata privacy remains a separate problem and must not be overstated.


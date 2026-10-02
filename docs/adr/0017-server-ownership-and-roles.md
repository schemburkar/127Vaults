# ADR-0017: Server ownership and roles

- Status: Proposed
- Date: 2026-09-06

## Roles

The initial server control-plane roles are user, admin, and owner. Vault roles are
separate and never implied by server role.

- **User:** manages their account and vault memberships.
- **Admin:** manages invitations, users, server settings, authentication locks,
  and other delegated control-plane operations, but receives no automatic vault
  key or content access.
- **Owner:** includes admin capabilities and controls ownership membership,
  licensing, destructive server operations, and other root settings.

A server may have multiple owners and must always have at least one active owner.
The last owner cannot leave, delete their account, be demoted, or be removed until
another owner has accepted ownership.

Admins cannot add, remove, or demote owners. An existing owner initiates an owner
grant/transfer and the receiving enrolled user must explicitly accept with fresh
authentication. The action is audited and visible to all owners. Adding an owner
does not grant access to any private or shared vault unless its vault policy and
cryptographic membership separately grant it.

The exact permissions for server shutdown, backup restore, license installation,
network-mode change, email configuration, user suspension, and server deletion
must be enumerated before implementing authorization middleware.

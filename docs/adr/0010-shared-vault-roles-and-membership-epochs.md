# ADR-0010: Shared-vault roles and membership epochs

- Status: Proposed
- Date: 2026-09-06

## Roles

All users may create shared vaults. Permissions are cumulative:

- **Reader:** decrypt, reveal, copy, and use every item in the vault;
- **Writer:** reader capabilities plus create, modify, and delete items;
- **Manager:** writer capabilities plus invite/remove members, assign reader or
  writer access, and appoint or remove managers;
- **Owner:** manager capabilities plus transfer ownership and authorize vault
  deletion or other irreversible ownership actions.

The creator is the initial owner. A manager cannot remove or demote the owner,
transfer ownership, or perform final vault deletion. The owner may appoint multiple
managers. Ownership transfer requires explicit acceptance by the new owner before
the previous owner can leave. A vault always has exactly one owner in the initial
model.

“Manage without read” is not supported. Granting manager status requires granting
the vault key and therefore read access. A server administrator has no automatic
vault role. A vault may explicitly allow an administrator to become manager; that
action is visibly equivalent to granting the administrator read access and must
provision cryptographic access normally.

## Removal and key epochs

Server authorization immediately blocks a removed member/device from normal sync,
but that alone is insufficient under the malicious-server threat model. A removed
member retains old vault keys and may obtain ciphertext through backups, another
member, a compromised server, or a defect.

Every membership removal therefore advances a monotonic vault epoch and creates a
fresh random vault key. The new key is wrapped only to remaining authorized
recipients. All future operations use the new epoch and key. Clients reject an
operation whose epoch is invalid for its claimed position in membership history.

Rotation provides future confidentiality; it cannot erase secrets or ciphertext
the removed member already decrypted. Re-encrypting unchanged historical objects
under the new epoch may run in the background, but it cannot undo prior access and
must not block publishing the new membership epoch. The sync protocol must define
concurrent offline edits across an epoch boundary, key-envelope acknowledgement,
stalled devices, and safe retirement of old keys.

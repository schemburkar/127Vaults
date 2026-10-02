# Vault management acceptance

This document records the remaining cross-client vault work. The current
private directory format permits at most five vaults, and schema 4 allows
several vault rows per account. That format limit is not a product limit and
must be removed in a reviewed format migration before the MVP claim.

## Shared behavior

- Vault names must be encrypted client-side and synchronized through a
  versioned, authenticated record. The server must not learn names or
  collection labels. Renames must survive restart, work offline, reconcile
  across devices, and show conflicts when concurrent names disagree.
- Desktop and CLI must use the same vault IDs, names, and lifecycle state.
  Item lookup must always retain the owning vault ID, including an all-vault
  or collection view. A new item in exactly one selected vault goes there;
  an all-vault or multiple-vault view requires an explicit destination.
- Collections are named sets of vault IDs. The clients must support create,
  rename, membership changes, removal, and a default view preference. A
  collection changes the view, not item ownership. Unavailable vaults must
  remain visibly unavailable instead of silently disappearing from a saved
  collection.
- A per-profile default vault exists now. A synchronized account preference
  and a default collection remain to be implemented. A stale default falls
  back to an explicit available-vault choice.

## Removal contract

Vault removal is unavailable until both of these choices are implemented:

1. Move every item to a vault chosen by the user. Re-encrypt each item under
   the destination vault key, verify the destination copy and signed history,
   then retire the source item. A restart or failed sync must resume safely
   without loss or unnoticed duplicate items.
2. Archive every item. Archived items remain encrypted, recoverable, and
   associated with their source vault until an explicit retention policy can
   purge them. Removing a vault must never delete its items as a side effect.

The removal dialog and CLI command must offer both choices. The user may save
either choice as a preference, but a saved move preference still needs a valid
destination vault. Refuse removal of the last accessible vault until a safe
archive location or destination exists. Block final retirement while pending
operations or unresolved conflicts remain. Test each choice offline, after
restart, and with a second device before enabling removal.

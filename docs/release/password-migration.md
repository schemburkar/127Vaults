# Password import and export

The 0.1.4 client requires an installation-bound signed license. Active licenses
allow imports and edits. During the 30-day read-only grace, reads and exports
remain available. After grace, obtain a signed trial or renewal from the operator
before unlocking or exporting. The request workflow will be added separately.
Encrypted vault data is preserved when access is blocked.

## Import

In desktop, open **Settings → Vaults → Import passwords**, choose the destination
vault or **Source vaults**, select a source and file, preview the count, then choose
**Import items**. A named destination combines all imported items into that vault.
**Source vaults** creates separate vaults using 1Password vaults, Bitwarden folders,
LastPass grouping, or native 127Vaults vaults. Ungrouped items go into an Imported
or Unfiled vault. Only groups containing imported items are created. Existing
vaults are not reused or overwritten: a conflicting name receives an imported
suffix. Preview lists the planned names and counts without creating anything.
Changing the destination invalidates the previous preview. Source mode requires
an online session and available slots within the existing ten-vault limit;
each source group must fit the 100-item limit. All limits are checked before
creating vaults. Network or lock failures can still interrupt a confirmed import;
retain completed vaults/items and inspect them before retrying.

The same parser
is available through an unlocked CLI agent:

```powershell
127vaults import --vault V-EXAMPLE --format bitwarden --file C:\private\bitwarden.json
127vaults import --vault V-EXAMPLE --format bitwarden --file C:\private\bitwarden.json --confirm
```

Use your actual vault name, ID or reference. Supported sources:

- `1password`: unencrypted `.1pux`, login records only. In desktop, choose **Read
  export**, select the source vaults, then preview and confirm. Vault selection
  happens before destination capacity checks, so a small vault can be imported
  from a larger account export. Tags and individual item selection are not yet
  available.
- `lastpass`: UTF-8 CSV with url, username, password, extra, name, grouping and fav columns. Quoted commas, quotes and multiline notes are supported.
- `bitwarden`: unencrypted JSON, login records without passkeys or attachments.
- `127vaults`: the native plaintext JSON export described below.

Vendor imports populate the normal username, password and website fields. Notes
and supported text/custom fields become readable individual fields; concealed
vendor fields stay concealed. Raw source JSON is not added. Unsupported vendor
metadata is not converted; retain the original export for omitted details.
Legacy raw JSON fields are hidden in desktop without rewriting existing records.
The 1Password importer skips unsupported types and login records without usable
login fields. Attachment payloads are never opened or extracted; supported login
credentials still import when the export contains attachments. The preview and
completion summary report unsupported-item and attachment-file counts for the
whole export, including unselected vaults. These counts exclude deliberately
unselected supported logins. Keep the original export for excluded content.
Bitwarden still rejects unsupported item types, passkeys and attachments before
writing any records. LastPass secure-note data remains in
the original-record field; attachments are not part of its CSV export.

Files are read locally; only newly encrypted vault records are synced. Files are
limited to 32 MiB, including expanded 1PUX data, and individual normalized records
to 48,000 bytes. Existing catalogue limits allow 100 items per vault, so split a
larger import among vaults. Capacity and record validation happen before writes.
Imports create new items: repeating a confirmed import creates duplicates.
Network, license or lock failures can interrupt a batch after some items have
been saved. The error reports the completed count; inspect those items before
importing only the remaining records. Locking stops the batch between items.

## Export

The CLI exports the desktop/shared local replica through its unlocked agent.
It never prints export contents to the terminal and refuses to overwrite files.
Choose a private destination folder. `--plaintext` is required because the file
contains readable passwords and other secrets.

```powershell
127vaults export --output C:\private\vaults.json --plaintext
127vaults export --output C:\private\bitwarden.json --format bitwarden --plaintext
```

The default `127vaults` format is `127vaults-plaintext-v1`: a documented JSON
object containing `settings` and `vaults`. Each vault contains its display
metadata, current `items` with their complete decrypted `index` and `body`,
separate `pendingDrafts`, and conflict identifiers. All locally available vaults,
including archived vaults, are included. Pending drafts that differ from current
items are recovered as separate items by native import. Native import can combine
the selected file's items into one destination or recreate source groupings; it does not restore
vault IDs, original timestamps, collection layout, sync history or server
identity. Keep encrypted server/identity backups for full installation recovery.

The optional `bitwarden` format exports login/password items as Bitwarden JSON,
with vaults mapped to folders and extra fields retained. A concealed original
127Vaults record preserves metadata that Bitwarden does not natively represent.
It refuses other item types, passkeys and unresolved conflicts: use the native
format for those. Exporting passkey material does not guarantee another manager
can use it.

An export describes the local replica at that moment. Sync first when the latest
server changes are needed. Exports do not include already deleted records or
credentials from devices that have not synced. Remove plaintext source and
export files from ordinary folders, downloads and shared/cloud folders when
finished; removal is not a promise of secure erasure.

## Operator licenses

The offline issuer accepts `personal`, `commercial`, `trial` and `development`.
Trial/development use the same Ed25519 signature, installation binding, expiry,
sequence and seat enforcement. Neither is an exemption tied to a machine name.
Keep the issuer private key outside the repository and customer packages. Install
a new signed license with a higher sequence through the normal server operator
workflow, then restart the server. Existing profiles reconnect once to cache the
verified entitlement before subsequent offline use.

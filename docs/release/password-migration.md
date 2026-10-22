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

- `1password`: unencrypted `.1pux`. Choose **Read export**, select source vaults, then preview and confirm. Imports logins, cards, secure notes, identities, passwords, licenses, bank accounts, databases, memberships/rewards, passports, wireless credentials, server/SSH credentials, email accounts, API credentials and medical records. Unknown categories become Custom items with their source category recorded. Documents and archived items are excluded. Vault selection happens before destination capacity checks. Tags and individual item selection are not available.
- `lastpass`: UTF-8 CSV with url, username, password, extra, name, grouping and fav columns. Quoted commas, quotes and multiline notes are supported.
- `bitwarden`: unencrypted JSON, login records without passkeys or attachments.
- `127vaults`: the native plaintext JSON export described below.

Vendor imports populate normal credentials, readable notes and individual custom fields. 1PUX v3 typed values retain labels, sections, concealment, address components, phone values, and additional websites. Matching template fields populate native fields; unmatched readable values remain in custom sections. Repeated top-level field labels receive a numbered suffix so imported items remain editable; section field labels remain intact. Numbers and dates retain their exported string representation; numeric date timestamps are retained as text rather than guessed dates. Guarded/concealed values remain concealed. Raw source JSON is never added. Legacy raw JSON fields remain hidden without rewriting old records.

1Password TOTP setup strings populate the existing encrypted authenticator field without a storage migration. Supported configurations use Base32 secrets of at least 80 bits, SHA1/SHA256/SHA512, 6 or 8 digits, and periods of 15–120 seconds. Only one setup is activated per item. Extra or unsupported setup strings are retained as concealed custom fields and counted as fields without native behavior. HOTP is not activated. In edit mode the setup value stays masked; its Copy button copies the original setup secret or URI through the normal clipboard workflow. The read view continues to show the rotating code.

SSH private and public key strings are preserved exactly, including whitespace and line endings, without conversion or key generation. Private keys are concealed; public keys remain text unless the source marks them guarded. This provides storage, not an SSH signing agent. Multiline values remain intact through desktop and web edits.

Additional websites have explicit `website-alias-` field IDs and URL types. Desktop and web can add/edit/remove them. The extension matches their exact HTTPS origin, including port, and rechecks the match before releasing credentials. It does not match arbitrary URL custom fields, subdomains, suffixes, or HTTP downgrades. Passkey origin restrictions are unchanged.

Files under `files/` are counted but never opened or extracted. The count includes documents, attachments and custom icons. To keep a document elsewhere, use Google Drive, iCloud, OneDrive or another preferred storage provider and manually save its link in a URL field. The importer does not upload files, create links or change external sharing permissions. Passport/identity items contain normal fields, not document attachments.

Inspection/preview/completion return supported counts by destination item type, excluded-item counts, archived-item counts, file counts and fields omitted or retained without native behavior. Item/file exclusions cover the whole export, including unselected vaults. Field counts and type counts cover selected importable items. Unknown structured values are omitted and counted rather than exposed as raw JSON. Tags, favorites, archive restoration, timestamps, password history and item-reference relationships are deferred; archived items are excluded to avoid reactivating credentials. Passkeys cannot be recovered from ordinary desktop 1PUX exports.

Bitwarden still rejects unsupported item types, passkeys and attachments before writing. LastPass remains CSV-based. Neither importer is broadened by the 1Password category mapping. Keep the original export for excluded data.

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

# Official CLI MVP

The CLI is a first-party client using the same OPAQUE, encrypted-vault, device-key,
and signed-sync contracts as web. The server receives neither the master password
nor plaintext item fields. `login` starts a per-user local unlock agent that keeps
only the server session and usable root-key handle in memory. The account secret
and master password are erased after that login exchange. The agent locks after
30 minutes without an authenticated command, or immediately on `lock`/`logout`.
Item passwords and unlock credentials use no-echo prompts; item `get` redacts the
password.

## Human web ↔ CLI run

Keep `https://127.0.0.1:12780` open and unlock the existing owner in the web app.
Use a disposable local CLI profile:

```powershell
cargo run -p vaults-cli -- server trust --url https://127.0.0.1:12780 --ca .tools\acceptance-ca.crt --server-id 127vaults-local --config-dir .127vaults-cli
cargo run -p vaults-cli -- login <owner-username> --enroll --config-dir .127vaults-cli
```

During enrollment:

1. The CLI submits a signed request and displays an eight-character code.
2. In the already-enrolled web app, open **Trusted devices**, enter that code,
   and select **Approve CLI device**.
3. The CLI polls for the bound browser approval, verifies its signature, proves
   possession of its proposed key, and sends that proof to the server.
4. The CLI stores its device key only after it receives and validates the
   server's success receipt. No enrollment JSON is copied between clients.

`login --enroll` continues into login after enrollment. For later login checks use:

```powershell
cargo run -p vaults-cli -- login <owner-username> --config-dir .127vaults-cli
cargo run -p vaults-cli -- status --json
cargo run -p vaults-cli -- vault list
cargo run -p vaults-cli -- vault info Private
cargo run -p vaults-cli -- item list
cargo run -p vaults-cli -- item get I-0123456789
cargo run -p vaults-cli -- item create --field title=Example --field website=example.com --field username=owner
cargo run -p vaults-cli -- item edit I-0123456789 --json '{"title":"Example","website":"https://example.com","username":"owner","password":"replacement"}'
cargo run -p vaults-cli -- item list --all
cargo run -p vaults-cli -- vault default V-0123456789
cargo run -p vaults-cli -- sync
cargo run -p vaults-cli -- conflict list
```

A successful login remembers its profile path, so later commands can omit
`--config-dir`. Supplying a non-default path still selects that profile explicitly.
If the account has exactly one vault, item commands can omit `--vault`; accounts
with zero or multiple vaults receive an explicit selection error.
`item list --all` returns item summaries from every local vault with their
vault IDs; create, edit, and get still require an unambiguous destination.
`vault default` shows the preferred vault for this local profile; pass a vault
selector to set it, or `--clear` to remove the preference. The desktop opens
that vault on unlock when it uses the same profile directory. This preference
stores only the vault UUID locally and works offline.

`vault archive VAULT` retires a vault while keeping its encrypted items
recoverable; `vault restore VAULT` makes an archived vault writable again.
Archive requires an online, synchronized vault with no pending edits or conflicts
and a settled signed checkpoint. The CLI saves an encrypted-settings removal
request before sending it, so repeating the same archive command resumes a
request whose response was lost. `vault list` marks retired vaults; unqualified
item commands and `item list --all` use active vaults.

`sync` submits queued operations, refreshes verified replicas, and reports how
many operations remain pending. Conflicts keep their signed local request until
an explicit choice. `conflict list` shows operation IDs and field names;
`conflict show <operation-id>` shows the local draft with password fields redacted.
Use `conflict resolve <operation-id> --keep server` to discard only that queued
operation, or `--keep local` to encrypt and queue the local draft against the
current verified item. Add `--vault` when multiple vaults are available. A
remote deletion cannot be overwritten by `--keep local` through this command.

Create and edit are noninteractive by default. They accept an inline JSON object,
JSON from stdin (`--json -`), JSON from a file (`--json @path`), or repeatable
`--field KEY=VALUE` arguments. Use `--interactive` to request terminal prompts.
Plain website domains are normalized to HTTPS; HTTP(S) URLs remain accepted.
Unknown KVP names create custom text fields; use `NAME:TYPE=VALUE` for a typed
custom field, for example `--field pin:password=1234`. JSON uses the web-compatible
`customFields` array with `label`, `type`, and string `value` members. In PowerShell,
prefer `--json @item.json` or pipe a here-string to `--json -` to avoid shell quoting
of an inline JSON object.

First-party types are `login`, `bank`, `card`, `wifi`, `router`, `ssh`, and
`password`. Select one with `--type` or a JSON `type` property. For example,
`item create --type wifi --field title=Home --field ssid=Home --field password=...`
stores the same encrypted type marker used by desktop and web. Known field IDs
such as `card_number`, `cvv`, `ssid`, `host`, and `port` retain their first-party
identity when supplied with `--field`. Use `:password` for sensitive typed
fields, such as `card_number:password=...`. JSON `customFields` also accepts the
desktop section marker and section field IDs, so a desktop item can be edited
without changing its section structure. `item get` reports `itemType` and keeps
password-class values redacted; `--password FIELD` remains the explicit reveal
path. `item list` shows every type by its encrypted title/website index without
opening item bodies, so it does not display type or section labels.

Vault selectors accept the displayed name (`Private`), generated `V-…` code, or
internal UUID. Item selectors accept a unique title, generated `I-…` code, or
internal UUID. Generated codes are stable, non-name-derived references; an
unlikely collision fails as ambiguous rather than selecting the wrong record.

Normal `item get` output redacts password fields. To emit only the current MVP
password field for piping, opt in explicitly (the trailing newline is preserved):

```powershell
cargo run -q -p vaults-cli -- item get I-0123456789 --password password
```

Command output and downstream processes can expose or retain the password; shell
history, command arguments, and logs never contain the value unless the caller
explicitly redirects or passes the output onward.

Reload the web vault after the CLI create/edit and verify the encrypted change is
present. A different existing trust or device profile is never overwritten.

## MVP limits

- Windows stores the device seed in Windows Credential Manager; Linux uses the
  platform secret service. The unlock agent's random loopback capability is kept
  there as well; only its non-secret port is written to the profile. No plaintext
  item cache, master password, account secret, session token, or root key is
  written to the profile.
- Endpoint trust accepts loopback, RFC1918 LAN, or explicitly asserted Tailscale
  identities only. The CLI trusts only the supplied installation CA.
- QR enrollment, interoperability, checkpoint consumption/conflict UI, and
  recovery are later.

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
```

A successful login remembers its profile path, so later commands can omit
`--config-dir`. Supplying a non-default path still selects that profile explicitly.
If the account has exactly one vault, item commands can omit `--vault`; accounts
with zero or multiple vaults receive an explicit selection error.

Create and edit are noninteractive by default. They accept an inline JSON object,
JSON from stdin (`--json -`), JSON from a file (`--json @path`), or repeatable
`--field KEY=VALUE` arguments. Use `--interactive` to request terminal prompts.
Plain website domains are normalized to HTTPS; HTTP(S) URLs remain accepted.
Unknown KVP names create custom text fields; use `NAME:TYPE=VALUE` for a typed
custom field, for example `--field pin:password=1234`. JSON uses the web-compatible
`customFields` array with `label`, `type`, and string `value` members. In PowerShell,
prefer `--json @item.json` or pipe a here-string to `--json -` to avoid shell quoting
of an inline JSON object.

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

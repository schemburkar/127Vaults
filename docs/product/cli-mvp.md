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

An already enrolled CLI can also approve the new client; see trusted-device
management below. The requesting CLI prints its code, full device UUID and
SHA-256 signing-key fingerprint to stderr while it waits. The existing desktop
enrollment callback remains compatible with its code-based UI.

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

## Trusted-device management

These commands use the selected CLI profile's unlocked, online agent. Log in
first; an offline unlock cannot read server device state, approve an enrollment,
or revoke trust. They use the same pinned HTTPS, session cookie, Origin and CSRF
boundary as the other authenticated commands.

```powershell
127vaults device list
127vaults device inspect ABCDEFGH
127vaults device approve ABCDEFGH --device-id <full-new-device-UUID> --fingerprint <full-SHA256-fingerprint>
127vaults device revoke <full-other-device-UUID>
```

Add `--config-dir PATH` to select an explicit profile. List returns the account's
device metadata and `currentDeviceId`; inspect returns the proposed device UUID,
enrollment UUID, signing-key fingerprint and expiry without approving anything.
Inspection does not print the raw public key, account ID, poll token, signing
key or session credentials.

To enroll a second CLI without a browser:

1. Log in with the already enrolled Client A.
2. Configure trusted endpoint/CA material in a **new** Client B profile, then run
   `127vaults device enroll --username USERNAME --config-dir CLIENT_B` there.
3. On Client A, inspect the displayed code. Compare the proposed UUID and complete
   fingerprint directly against Client B's output.
4. Approve on Client A with that code, `--device-id` and `--fingerprint`. Type
   `yes` at the confirmation prompt. Client A re-inspects the request and binds
   its signature to the reviewed enrollment, device and signing key.
5. Client B verifies the approval, proves possession, receives a success receipt
   and stores its device identity. Log in on Client B to start its own agent.

Approval's JSON result includes `enrollmentComplete: false`: approval is one step;
the requesting client still has to finish possession proof and enrollment. A
changed enrollment, device or key is refused before signing. Invalid polling
responses fail rather than looping, and polling has a monotonic ten-minute
deadline in addition to server expiry and the HTTP request timeout.

Approve and revoke require interactive confirmation. For deliberate automation,
append `--yes`; approval still requires the expected device UUID and full
fingerprint and still performs the review checks. Prompts/review are written to
stderr so successful list/inspect/approve/revoke stdout remains JSON. Redirected
input without `--yes` is refused before any approval or revocation request.
Cancellation leaves trust unchanged.

Revocation only accepts an active device listed for the account and refuses the
current device, including alternative UUID capitalization. Successful revocation
invalidates that other device's server sessions and records an audit event. It
does not erase an offline encrypted replica or guarantee immediate offline lock.
Credential rotation and lost-device recovery remain separate release work; no
CLI rotation command is exposed. The browser native host and read-only connector
agent cannot dispatch these device-management commands.

### Repeat the device-management checks

```powershell
pnpm test:device-management
pnpm test:device-management --rust
```

The first command needs a working Podman engine and the locally available
`docker.io/library/postgres:17-bookworm` image. It creates a new loopback-only,
in-memory PostgreSQL fixture, installs the current schema, verifies enrollment,
approval, replay, account isolation, sessions and revocation audit, then removes
the container. It never reads `.env`, uses a live database, or pulls an image.

`--rust` also needs Cargo and the local `docker.io/alpine/openssl:3.5.4` image.
It compiles the CLI library test binary and creates an ephemeral CA and server
certificate, then runs the Rust client against the production device handlers
and the real PostgreSQL store over pinned-CA HTTPS. This fixture supplies a
preauthenticated account context; it does not verify OPAQUE login, OS keyring
storage, a full two-agent terminal walkthrough or clean-machine installation.
The fixture's certificates and keys are removed afterward. `--docker` selects
Docker as an unverified alternate engine until its host matrix is run.

## Vault and item workflow

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

`vault move SOURCE --to DESTINATION` copies each decrypted item into fresh
destination ciphertext and retires the source only after every copy, signed
create operation, checkpoint, and plaintext comparison succeeds. The move
reserves destination item IDs in a local journal before copying; repeating the
command resumes the same IDs after interruption. The server keeps the retired
source recoverable. `vault removal-status` shows the pending plan and item IDs.
If a source changes during copying, the CLI stops with both vaults intact;
`vault abort-move --keep-copies` clears an unfinished plan after the operator
reviews destination copies. A final removal request must be retried instead of
aborted. The saved removal preference records the preferred choice; archive and
move commands still require an explicit source and move requires a destination.

`sync` submits queued operations, refreshes verified replicas, and reports how
many operations remain pending. Conflicts keep their signed local request until
an explicit choice. `conflict list` shows operation IDs and field names;
`conflict show <operation-id>` shows the local draft with password fields redacted.
`conflict compare <operation-id>` refreshes verified server state without submitting
the queue and returns both versions with built-in, custom and related password
fields redacted. It includes the owning vault/item/operation IDs and reports an
absent server item explicitly. Failed/offline comparison preserves the queued edit.
Use `conflict resolve <operation-id> --keep server` to discard only that queued
operation, or `--keep local` to encrypt and queue the local draft against the
current verified item. Add `--vault` when multiple vaults are available. A
remote deletion cannot be overwritten by `--keep local` through this command.

`conflict merge <operation-id> --base local --field-source title=server` saves
the local version's fields with the verified server title. The base is required;
repeat `--field-source FIELD=local|server` for `title`, `website`, `username`,
`password`, or `customFields`. Custom fields are selected as one complete array,
including type metadata and related sections. Unknown or repeated field choices
are refused. The command retrieves secret values internally, without requiring
passwords in command arguments or printing them. An absent server item is refused
and its queued edit is retained.

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

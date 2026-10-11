# 127Vaults

> Experimental, pre-release software. Do not store real credentials.

127Vaults is a secure-by-default password manager for private networks. Clients
are intended to encrypt vault data before synchronization; the server stores
opaque ciphertext and is not intended to possess vault decryption keys. Those
properties are design goals, not claims about the current experimental build.

## Current status

The fictitious-data internal MVP now has private HTTPS, OPAQUE authentication,
owner/invited-user onboarding, and encrypted PostgreSQL vault create/list/read/
update paths. It remains experimental: do not use real credentials, and do not
treat it as public-beta or stable-format approval.

Current work and release documents:

- [Four component backlogs and active waves](docs/product/README.md)
- [Installed PWA, offline use, and mobile validation](docs/product/pwa.md)
- [API v1 protocol and CLI naming](docs/architecture/api-v1-contract.md)
- [Beta-readiness gates](docs/release/beta-readiness.md)
- [Experimental development runbook](docs/release/experimental-development.md)
- [Offline server test bundle and installation](docs/release/server-test-install.md)
- [Independent local releases with release.ps1](docs/release/release-command.md)
- [Selected real-data pilot gate](docs/release/selected-real-data-pilot.md)
- [Cross-surface MVP and platform audit](docs/release/cross-surface-audit-2026-10-06.md)

## Repository map

```text
apps/       server, web, extension, desktop, and CLI surfaces
crates/     Rust cryptographic and protocol foundations
packages/   shared TypeScript API, domain, and sync packages
docs/       architecture, security, product, sync, and release decisions
```

## Development entry points

The supported v1 development deployment is container-only. With Podman and a
Compose provider installed:

```sh
pnpm dev:up
pnpm dev:status
pnpm dev:down
```

See the [runbook](docs/release/experimental-development.md) before operating the
stack. Native server commands are unsupported debug tools, not a deployment
option. The separate Rust/WASM demonstration is documented in the
[browser-fixture guide](docs/release/rust-browser-fixture.md).

### Run the server and both clients during development (Windows)

The launcher helper is [`dev.ps1`](dev.ps1) in the repository root. From
PowerShell, choose the components you want:

```powershell
cd C:\Projects\127Vaults
.\dev.ps1
```

| Command | Starts or shows |
| --- | --- |
| `.\dev.ps1` | API/server, hot-reload web client, desktop app, and extension loading instructions |
| `.\dev.ps1 server` | API/server and hot-reload web client |
| `.\dev.ps1 desktop` | Desktop app only |
| `.\dev.ps1 server desktop` | API/server, hot-reload web client, and desktop app |
| `.\dev.ps1 extension` | Extension loading and reload instructions only |

**To start the web app, use `server`.** The helper accepts `server`, `desktop`,
and `extension`; there is no separate `web` argument. Open the web client at
`https://127.0.0.1:12780`. Desktop-only startup does not start the API; it uses
its configured server or an existing encrypted offline replica.

The helper opens separate PowerShell windows for the selected development
processes, with their output visible. Stop a process with Ctrl+C in its window.
To stop the acceptance API/database containers afterward, run `pnpm mvp:stop`;
this retains the database volume.

The extension has no development process: load `apps/extension` unpacked in
Chrome or Edge, then click Reload on its extension card after changing its
files. `.\dev.ps1 extension` prints these instructions.

Install the workspace dependencies with `pnpm install` and complete the `.env`
and local TLS setup in the [development runbook](docs/release/experimental-development.md)
first. In a normal PowerShell window at the repository root, start the
containerized API and hot-reload web client:

```powershell
cd C:\Projects\127Vaults
pnpm mvp:dev
```

Keep that window open. In another PowerShell window, launch the desktop client:

```powershell
cd C:\Projects\127Vaults
pnpm --filter @127vaults/desktop dev
```

Open the web client at `https://127.0.0.1:12780`. If this is a fresh disposable
owner setup, run `pnpm mvp:browser` in a third window to print the local CA path
and one-time bootstrap code. Trust the local CA in Windows/browser settings;
do not bypass a certificate warning. `pnpm mvp:dev` uses port 12780 for the web
client and port 12781 for its containerized API. Stop the hot-reload command
with Ctrl+C, then run `pnpm mvp:stop` to stop the acceptance containers while
retaining their database volume. For a served, non-hot-reload browser run, use
`pnpm mvp:start` instead of `pnpm mvp:dev`.
If startup reports an older database schema, run `pnpm mvp:migrate` once; it
checks and applies each pending migration in order, then restarts the server.
Run `pnpm mvp:dev` again afterward. Do not reset the database to fix a schema
version mismatch.

## Repeat the internal-MVP acceptance

After configuring `.env` and TLS as described in the runbook:

On Windows, run these commands in a normal PowerShell window under your user
account, not a Codex sandbox/integrated terminal. If Podman asks for
`user@127.0.0.1`'s password, press `Ctrl+C`; Podman failed to read its SSH key.

```sh
pnpm mvp:start
pnpm mvp:exercise
pnpm mvp:view
pnpm mvp:stop
```

The exercise preserves the owner/database, creates a fresh invited user, checks
SMTP activation/login, isolation, TLS Host/SNI, and known plaintext markers.
Stopping retains its PostgreSQL volume.

### See the browser MVP

Use fictitious data only. For a fresh interactive run:

```sh
pnpm mvp:stop
pnpm mvp:reset
pnpm mvp:start
pnpm mvp:browser
```

`mvp:reset` permanently deletes only the disposable acceptance database. Trust
the local CA path printed by `mvp:browser` in Windows/browser certificate
settings, then open `https://127.0.0.1:12780` and enter its printed one-time
bootstrap code. Use a fictitious 64-hex-character account secret and 20+
character master password. Create the owner, unlock, create a vault and item,
lock, reload, then unlock again. Remove the local CA trust entry after testing
if it is no longer needed.

Use the [browser MVP walkthrough](docs/release/browser-mvp-walkthrough.md) for
expected screens, safe troubleshooting, limitations, and a feedback checklist.

## Security and licensing

Do not use real credentials until the documented security and public-beta gates
are complete. Start with the [architecture overview](docs/architecture/overview.md)
and [threat model](docs/security/threat-model.md) when reviewing design claims.

The planned release model is Business Source License 1.1 changing to
AGPL-3.0-only four years after each release-specific Change Date, with alternate
commercial terms from day one. Source is not licensed for release until exact
BSL parameters are present in `LICENSE`. See [LICENSE-POLICY.md](LICENSE-POLICY.md).

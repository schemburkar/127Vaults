# 127Vaults Desktop

This is the shared Windows/Linux development client shell. Its Tauri commands use the same
Rust session and encrypted local replica as the CLI: online authentication can
hydrate a replica, later unlocks can authenticate and decrypt it offline, edits
are encrypted and durably queued before delivery, and explicit sync retries the
queue. The React renderer receives only the currently requested plaintext item.

The sidebar can collapse to a 72-pixel icon rail independently of the item list/grid preference. Hover an icon to see its navigation label. Use **Keep in tab** on an item to retain it in the detail pane, then switch among retained items; tabs keep their source vault and respect unsaved-edit confirmation. Tabs last for the unlocked session. Tabs keep readable widths and scroll horizontally with a mouse wheel or touchpad; the active tab is brought into view. Scroll arrows and the open-tabs menu make overflow accessible without a visible horizontal scrollbar. There is no ten-tab cap or automatic eviction. Closing the active tab selects a neighboring tab. Sidebar vault and collection markers use stable pastel colors derived from their IDs, so renaming or reordering does not change the marker.

**Open in window** opens a separate native detail window with reveal/copy controls. Reopening the same item focuses its existing window. Edit items in the main window; separate windows refresh from the replica and clear when the vault locks or the main window closes.

Run `node scripts/item-workspace-desktop-smoke.mjs` with a local desktop Vite server and Playwright to exercise these interactions using synthetic IPC responses. `VAULTS_PLAYWRIGHT_MODULE` and `VAULTS_BROWSER_EXECUTABLE` can select an installed runtime/browser.

Web and desktop share surface spacing, dialog widths, action rows, and access-card sizing in `packages/ui/src/layout.css`. Use `ui-dialog` for ordinary dialogs, `ui-dialog-wide` for comparisons, and `ui-dialog-workspace` when changing options should retain a stable height. Keep existing form and action IDs when applying these classes.

Run `node scripts/surface-layout-smoke.mjs` with both local Vite servers to check dialog bounds, long vault lists, narrow settings, access-card consistency, and generator resizing. Desktop IPC uses synthetic fixtures. `VAULTS_BROWSER_CHANNEL` can select an installed browser such as `msedge`; `VAULTS_LAYOUT_SCREENSHOTS` optionally saves screenshots to a directory. The web and desktop URLs can be overridden with `VAULTS_WEB_URL` and `VAULTS_DESKTOP_URL`.

## Unlock performance

The workspace development profile optimizes password derivation and curve arithmetic while retaining application debug builds. The frozen Argon2 parameters remain 64 MiB, three passes, and one lane. Run `cargo run --locked -p vaults-crypto --example unlock_timing` to measure root verification with synthetic material; this measures the crypto phase rather than total online unlock time. When rebuilding development binaries, also run `cargo build --locked -p vaults-cli --bin 127vaults` so the optional sibling connector agent uses the same optimized crypto.

Online unlock still authenticates with the server and checks signed history and checkpoints. Unchanged encrypted item bodies can be reused only after authentication against the current server catalogue; missing, changed, or invalid bodies are downloaded and verified. License and removal status load after the verified vault is shown. License network I/O runs outside the session mutex so a slow status request cannot block browsing or locking.

Website passkeys registered through the extension appear as dedicated encrypted
items and sync through the same replica. Their private keys are excluded from
generic item summaries and renderer field hydration; saving an existing passkey
preserves its key inside Rust. Use the extension to register and sign in, with a
fresh master-password check for each request. The connector agent supports only
the narrow create-only passkey save exception to its read-only password policy.
See [passkey setup and limits](../extension/README.md#website-passkeys).

Vault removal is available from a vault's menu or Settings > Vaults. Archive
retains the encrypted source vault for later restore; move requires a chosen
active destination and re-encrypts its items there before retiring the source.
The Rust session records a durable plan so an interrupted operation can be
resumed after unlock. Settings shows a pending plan; a move can only be cleared
while copying, and destination copies may remain for review. Both operations
need an online session with settled local edits and no unresolved conflict.
The server currently limits a move to 50 source items.

Preferences > Default view is the desktop's opening-view setting and syncs
across devices. A local CLI default-vault preference has no effect on desktop.

Tauri's `dragDropEnabled` option is deliberately `false`. Despite its name, the
default `true` selects Tauri's file-focused native drop handler and prevents DOM
HTML5 drag events on Windows. `false` restores the WebView's HTML5 drag path used
by this outbound-text experiment, at the cost of native incoming-file drops in
this window. A future client can use a separate import window or native command
for incoming files; do not flip this option without re-running the matrix.

## Run on Windows 11

Install the Rust toolchain, Microsoft C++ Build Tools, WebView2 Runtime, and the
workspace JavaScript dependencies. From the repository root:

```powershell
pnpm --filter @127vaults/desktop dev
```

Select an item, then drag either field's handle onto a browser `<input>`, Notepad,
or another editable text control. Press Escape to exercise cancellation.
The HTML drag payload necessarily enters
the WebView2/Windows drag subsystem while a drag is active.

## Run on Linux (development)

Use Ubuntu 24.04 with a graphical desktop, or a separate Ubuntu 24.04 WSL2
instance with WSLg. The existing Ubuntu 20.04 WSL instance lacks WebKitGTK 4.1
and cannot build this Tauri 2 shell.

This workstation now has a separate `Ubuntu-24.04` WSL2 development instance;
see installed environment and commands (internal record retained outside Git).

Install the [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/)
and the shared engine's keyring dependencies:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl wget file libxdo-dev libwebkit2gtk-4.1-dev \
  libssl-dev libsecret-1-dev libdbus-1-dev librsvg2-dev \
  libayatana-appindicator3-dev patchelf
```

Install Rust through rustup (the repository selects its pinned toolchain),
Node.js 24, and the pnpm version in the root `packageManager` field. Use a
Linux-side checkout and dependency installation; do not reuse Windows
`node_modules` or Cargo targets through `/mnt/c`.

```bash
pnpm install --frozen-lockfile
pnpm check:desktop
pnpm --filter @127vaults/desktop dev
```

A running, unlocked Secret Service on the user's D-Bus session is required for
credential storage. Installing development headers does not establish a usable
keyring. Use sample credentials for testing.

## Shared Windows/Linux development gate

From the repository root, `pnpm check:desktop` runs frontend checks and desktop
tests, shared CLI unit tests, and a locked Tauri release build without installers.
On Linux it first checks native dependencies with `pkg-config`.
`.github/workflows/desktop.yml` runs the same gate independently on Windows and
Ubuntu 24.04 for pull requests, main pushes, and manual dispatch. No signed
installer or update artifact is produced.

Build success is only the first Linux milestone. Record the distro, desktop,
WebKitGTK version, display protocol, and keyring provider for GUI acceptance:

- Launch, enroll with a sample account, online unlock, lock, and restart.
- Hydrate a replica, stop the server, then offline unlock and queue an edit;
  restart, reconnect, and sync without losing the edit.
- Exercise a missing/locked keyring and verify useful errors without plaintext
  persistence or silent fallback storage.
- Exercise reveal/copy and drag cancellation/lock on Wayland and X11, including
  browser login inputs and a native text editor.
- Repeat installation and keyring behavior on a clean native Linux host before
  accepting Linux packaging or supported distribution claims.

WSLg launch evidence alone does not close native Linux acceptance. Track these
gates in [the desktop backlog](../../docs/product/desktop-backlog.md).

## Scope and security boundary

- A physical drag gesture is required. Only `text/plain` is advertised, with a
  copy effect; there is no URI, HTML, file, or custom serialized payload.
- The clipboard API is never called, so clipboard history and sync are independent.
- The in-process payload is cleared on `dragend`, rejection/cancellation, lock,
  page hide, and a window-blur fallback. JavaScript strings and WebView2/OLE may
  retain immutable or copied buffers; this POC cannot promise native zeroization.
- Locking during a WebView2-owned synchronous OLE drag cannot reliably preempt a
  drop. Production work needs a native `IDataObject` whose `GetData` checks shared
  lock state and owns a zeroizable `HGLOBAL` buffer.
- Any accepting target receives the plaintext and can retain it. The source cannot
  determine whether an external target is trustworthy.
- Elevation is neither requested nor supported. Windows integrity isolation may
  reject dragging into an elevated target, which is the desired failure mode.

## POC test matrix / go-no-go gate

Record OS, WebView2 version, target/version, field type, username result, password
result, Escape cancellation, rejected drop, and lock/close behavior. Required
manual targets are Edge/Chrome login inputs, Firefox login inputs, Notepad, and
one Win32 business application. Also test an elevated Notepad target and confirm
that the unelevated POC cannot fill it.

This code is a **go for integrated development testing**, not a production-client
release. Ordinary focus and visibility changes deliberately do not lock or clear
login fields; production still requires a native OS session-lock signal, an
empirical drag matrix, a native revocable/zeroizable data object, field-aware
pending-operation rebase/conflict UX, accessibility review, signed builds, and
equivalent native investigations for macOS (`NSItemProvider`/pasteboard drag) and
Linux (Wayland/X11 data-transfer protocols). Tauri can remain the shared UI;
the secret-bearing drag provider should be implemented per OS.

## Framework checkpoint

Tauri is provisional, not a product constraint. 1Password has publicly described
its version 8 desktop architecture as an Electron/React UI over a shared Rust core.
That validates the general split—web UI plus native secret-bearing core—but does
not establish how its private drag implementation works. After the manual matrix,
compare this Tauri path with a small Electron fixture and a native Win32
`IDataObject`/`IDropSource` fixture. Prefer the least complex option that passes
revocation, cleanup, accessibility, signing, and cross-platform gates; binary size
alone is not a sufficient reason to keep Tauri.

## Omarchy acceptance

The installer includes pacman paths for Arch/Omarchy container engines, Compose
repair and Desktop runtime dependencies. Linux x64 AppImage and CLI packages are
the distribution formats; no separate Debian conversion is required. See
[client setup](../../docs/release/client-install.md#omarchy--arch-linux-x64).

Native Omarchy GUI acceptance is still required: record Omarchy/Arch package
versions, Hyprland/Wayland, GPU and Secret Service provider; repeat the Linux
acceptance steps above, including locked/missing keyring, native-host connection,
offline restart/replay and installer update/retry. Windows unit tests or Ubuntu
WSL results do not establish native Omarchy acceptance.

For a separate Arch/Omarchy WSLg package fixture, follow the
[Omarchy WSL runbook](../../docs/release/omarchy-wsl.md). The headless adaptation
can verify app startup and OS services while native Hyprland acceptance remains
separate.

## Import a private server connection

Install Desktop normally. On the first-run setup screen choose **Connect to your private server → Import server connection**, select the `.127vaults-server` file received from your administrator, check the server name/address and choose **Verify and connect**. Then sign in to your vault account and approve this desktop. New users still need their server administrator’s account invitation. The connection file is public configuration, not a login or purchase invitation.

Administrators export it from their local **Server administration → Connect devices → Share server connection** screen. Share through a trusted channel and ensure recipients can reach the private-LAN or Tailscale endpoint. One file works across supported desktop platforms. See [the portable file contract](../../docs/architecture/server-connection-file.md).

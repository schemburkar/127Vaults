# 127Vaults browser extension (experimental)

## Website passkeys

Rebuild the desktop/CLI native host and reload this unpacked extension after
updating. On an HTTPS website, open the extension and choose **Enable 127Vaults
passkeys on all HTTPS sites**, grant the one-time HTTPS-site permission, then reload
the website. This applies to newly visited HTTPS sites automatically; existing
per-site grants are migrated when you enable all-sites mode.
When the site creates or requests a passkey, open the extension (it may open
automatically) and review the displayed origin, account and selected source.
Choose a destination vault for registration or a matching saved passkey for
sign-in, then verify your 127Vaults master password. Local sources also need the
127Vaults username and account secret unless desktop remembers them. Unlock the
source before starting; a web source must stay open on the chosen vault.

Registration saves a new encrypted passkey item before completing the site's
WebAuthn request. Offline desktop/CLI registration saves durably in the local
replica; reconnect and sync that client to back it up on the server. Sign-in
does not write the vault. Desktop and web show the credential's website/account
and let you manage the item; private keys are excluded from ordinary editors.
Deleting the item does not revoke the website's credential: remove it in that
website's account settings too.

This first provider handles top-level HTTPS pages, exact-host RP IDs, ES256,
none attestation, discoverable credentials and registration credProps. Parent-domain RP IDs, frames,
conditional mediation, WebAuthn extensions other than registration credProps retain the
native browser path. **Use browser instead** is available before approval.
**Disable 127Vaults passkeys** removes provider registrations for all sites;
reload existing pages to restore the original methods. Disabling preserves the
shared browser site permission used by the vault connector. You can revoke site
access separately in the browser extension settings. No account sign-in changes are included.

See the [security design](../../docs/security/website-passkeys.md). Node tests
cover signatures, verification, exclusions, persistence ordering, navigation,
lock and expiry. `scripts/passkey-browser-smoke.mjs` additionally checks actual
Edge credential/response prototypes, typed buffers and native fallthrough with a
disposable synthetic source; it needs Playwright and an installed Edge browser.
This does not replace the installed-extension Chrome/Edge site matrix or an
independent security review.

### Testing alongside 1Password

Use a separate Chrome or Edge profile containing only 127Vaults for repeatable
tests. Keep 1Password installed in your usual browser/profile and desktop.
Alternatively, temporarily disable the 1Password browser extension, or turn off
its passkey save and sign-in offers under Settings > Autofill & save while keeping
password filling enabled. See [1Password's browser instructions](https://support.1password.com/save-use-passkeys/).

Windows also has a separate 1Password passkey-manager integration. If the Windows
picker still offers 1Password, it can be disabled temporarily under Settings >
Accounts > Passkeys > Advanced options, where available; see [the Windows guide](https://support.1password.com/save-use-passkeys-windows/).
This changes the provider setting, not the stored credentials or app installation.

Reload the test page after changing extension settings. A supported 127Vaults
ceremony should show its approval popup (or a KEY badge requiring you to open
the extension). A native Windows picker indicates a browser fallback or a
competing provider, not a confirmed 127Vaults save. All-sites permission does not
change the exact-host RP, algorithm, frame and extension limitations above.
Multiple extensions wrapping WebAuthn can override or chain each other's hooks;
127Vaults does not guarantee priority over another enabled provider.

The extension is a read-only password connector with an opt-in website passkey provider. Passkey registration has a narrow, explicitly approved create-only save exception. It can use an unlocked web tab, an active desktop or CLI unlock agent, or an installed desktop/CLI encrypted replica. A local replica can be unlocked with the account secret and master password when the server is unavailable. Desktop can reuse its cached account secret when available. The extension itself stores no vault replica or login edits.

Chromium Manifest V3 build for current Chrome and Edge. Load `apps/extension` as an unpacked extension in `chrome://extensions` or `edge://extensions` with Developer mode enabled. On a site's HTTPS login page, click the extension, choose a credential source and matching login, review the filled fields, and submit the form yourself. An active desktop/CLI source is selected by default; web remains available when connected. The popup can lock its selected source after use.

## Local connector setup on Windows

Build the CLI binary and native host from the repository root with `cargo build -p vaults-cli --bin 127vaults --bin 127vaults-extension-host`. In Chrome or Edge's extension page, copy the unpacked extension ID. Register the host with `apps/extension/install-native-host.ps1 -ExtensionIds <ID> -HostBinary target/debug/127vaults-extension-host.exe -Browser Both`. Pass both IDs as an array if Chrome and Edge assign different IDs. The script registers the host for the current Windows user. Run it again when the host executable moves. It does not install or unlock a vault profile.

The script resolves the host executable's absolute path, writes `com.127vaults.connector.json` beside it, limits `allowed_origins` to the supplied extension IDs, and writes the manifest path to the current user's Chrome and/or Edge native-messaging registry key. The browser reads that registration and launches the host when requested. The extension cannot scan the computer for installed executables or registry paths; it asks Chromium for the named host. The host itself looks for enrolled desktop and CLI profiles in their configured user locations. For testing, keep the host executable at the registered path; rebuilding it in place is fine, moving it requires registration again. If an unpacked extension receives a different ID, register that ID too.

For a supported Windows release, the desktop/client installer should place the host in a stable application directory and register its manifest during installation, repair and update. Published Chrome and Edge extension IDs must be pinned in `allowed_origins`; uninstall must remove the registration it owns. A standalone CLI distribution needs an equivalent host-install step. macOS and Linux require their browser-specific native-host manifest locations and packaging work. Test users currently install the unpacked extension and run this PowerShell registration once; there is no automatic production installer yet. Native messaging does **not** require a paid Windows code-signing certificate. Whether to Authenticode-sign a future Windows installer or host is a separate distribution decision; MSIX would require a trusted package signature, while a conventional installer or ZIP can be tested without one, with Windows reputation warnings possible.

An active CLI login is available through its local agent. Desktop starts an offline, read-only connector agent when it unlocks if `127vaults.exe` is beside the desktop executable; locking or exiting desktop stops an agent it started. A configured desktop or CLI profile with a hydrated encrypted replica can also be unlocked from the popup while offline. The native host accepts source discovery, list, get, unlock and lock. It also supports passkey metadata listing, selected-key retrieval after fresh password verification, and create-only passkey save; it exposes no generic edit operation. If only a web tab is available, that source remains online-only.

The extension asks for access to the configured vault host and stores only that public origin. Chromium host permissions cover all ports on that host; the extension itself selects the vault tab by the exact configured origin, including port. The active site is accessed only after the user clicks the toolbar action. Saved login and target page must have the same HTTPS origin. Cross-origin frames, HTTP pages, ambiguous multiple-password forms, automatic submission and automatic background fill are rejected. A username-only first step and a later password step can each be filled separately.

The selected source is the key holder. Closing or locking the web tab removes access to that source; an installed desktop/CLI replica can still serve offline fill after local unlock. The popup shows the oldest verified sync time across the installed source's vaults and labels offline data as potentially stale. Older replicas show an unknown time until they sync successfully. A credential is requested only after selection and is passed only to the chosen same-origin frame. Once filled, the destination page and its scripts can read the field values. Browser extensions, page scripts, screen capture and browser process memory limit any claim of complete zeroization. The background listener asks open web vault tabs and both local agents to lock when Chromium reports system idle or OS lock, even after the background worker restarts.

The password connector has no create, edit, delete, conflict-resolution or save/update workflow. The passkey provider can create a dedicated encrypted credential after explicit approval. This is an unpacked development build. Native-host registration, active desktop/CLI handoff, offline fill, Chrome/Edge store signing, updates, a full site matrix, phishing review and independent security review still need live acceptance before a supported release.

Each fillable login in a related detail appears as its own choice when its HTTPS website matches the active page. The parent item and a related login can therefore show as two rows. The connector resolves the selected related password only after the user chooses that row. The popup keeps the account list in a scroll area when many accounts match.

## Quick manual smoke test

1. From the repository root, build the host with `cargo build -p vaults-cli --bin 127vaults --bin 127vaults-extension-host`, then run `node apps/extension/scripts/native-host-smoke.mjs`. The script checks native messaging framing and source discovery; zero sources is valid before a vault is unlocked.
2. Load this folder unpacked in Chrome or Edge's extension page, record its extension ID, and run the Windows registration command above using that ID. Reload the extension after registration.
3. Unlock a test vault in desktop or CLI, or unlock the web client in a tab. Save a **fictitious** login whose website origin matches an HTTPS test login page you control exactly, including the port when present.
4. Open that HTTPS page, click the extension toolbar button, choose the unlocked source and test login, and request fill. Check that the username and password appear only after the click and that the form is **not** submitted automatically. Submit manually if this is a disposable test account.
5. Try an HTTP page and a different HTTPS origin: neither should receive the saved login. Lock the selected source and confirm that fill requires unlocking again. For the offline path, first hydrate a desktop/CLI replica, stop the server, then unlock that local source and repeat the fill on the already loaded HTTPS page.

If the popup shows no local source, check the extension ID in the native-host registration, the host executable path, and whether the desktop/CLI vault is unlocked. Web-tab source availability requires the matching web vault tab to remain unlocked. See [the browser extension security boundary](../../docs/security/browser-extension-boundary.md) for the wider acceptance matrix.

The vault web address is optional for desktop/CLI use. The popup now offers Refresh and checks for source changes while open, so unlocking desktop should appear without reloading the extension. A web-tab source still needs its HTTPS vault origin and browser permission. Reloading an unpacked extension is needed after changing extension code or its ID, not after an ordinary desktop unlock.

### Autofill.me registration test

The [Autofill.me registration page](https://autofill.me/form/passkeys-register.html)
requests `authenticatorAttachment: "platform"` from `/register/start`.
The local vault authenticator accepts this request and reports platform attachment
for registration and assertion, with internal transport. Platform attachment does
not imply Windows Hello or hardware-bound storage. No existing vault item is
needed: registration creates a new encrypted passkey item after fresh password
verification. Enable the provider, reload the page, and click Register normally.
127Vaults is not registered as a Windows passkey provider; its browser extension
handles the ceremony before the native picker. Use browser instead remains
available in the approval popup.

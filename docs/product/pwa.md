# Installed web app (PWA)

127Vaults has two browser modes. A regular browser tab requires a server connection. An app launched in standalone mode from the Home Screen or installed-app launcher keeps an encrypted device replica and supports offline unlock and editing.

## First use

1. Install the app while connected. On iPhone/iPad, use Safari → Share → Add to Home Screen. On Android, use the browser’s Install app/Add to Home screen action.
2. Open the installed app while connected. Enter your username and choose **Register this device** if this app does not already have a device identity.
3. Approve the displayed one-time code from an existing unlocked client’s device settings. Enter your account secret and master password once in the newly registered app.
4. Wait for sync to finish. Settings → Preferences shows **Ready for offline use** after both application files and a complete encrypted vault replica are available.

Subsequent unlocks require the master password only, including after closing/reopening the app offline. The account secret is wrapped with the master password and has no automatic expiry in installed mode. Browser-tab credentials retain their existing 30-day expiry. Removing website data or the installed app’s storage removes its identity and requires enrollment again.

iOS Home Screen apps have their own storage: enrollment in Safari does not necessarily carry into the installed app. Install first, then enroll from the installed app. [WebKit’s storage isolation explanation](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/).

## Available offline

- Password-only unlock, explicit lock, inactivity locking, and lock on page departure.
- All downloaded vaults and item bodies; search, favorites, password health, generators, authenticator codes, related sections, and typed/custom fields.
- Item creation, editing and duplication; vault creation and renaming.
- All-items browsing across vaults, collections, and the default view. The encrypted settings format is shared with the desktop client.

Offline saves commit to IndexedDB before reporting success. Only ciphertext, wrapped credentials, protocol metadata, and the nonextractable signing key are persisted; plaintext item data and passwords are not stored. Reconnect credentials are held only in the unlocked session and cleared on lock.

## Sync and recovery

Sync runs when connectivity returns, when the user chooses Sync, and on foreground retry while the unlocked app is connected. A persisted queue retains exact request IDs and signed operations until server acceptance, so a lost reply can be retried idempotently. A crash before a local transaction commits is not reported as a successful save.

Other-device changes are rebased onto the fresh encrypted catalogue. Conflicting items support keeping either version or selecting fields to merge. Conflicting settings require review; cancelling review preserves the queue. If another device removes the source vault, Sync offers to recover the offline items into an active vault, explicitly discard those edits, or review later. The last complete replica remains available if a refresh fails.

Downloaded operation IDs, device signatures, causal cursors, and per-device predecessor chains are verified before becoming the basis of another signed write. Device keys and the server checkpoint key are pinned; missed server checkpoints are fetched and verified in order against the operation history. Empty vault catalogues are authenticated too, and item lists must match the catalogue’s complete committed item set. Modified queued payloads or redirected queue paths cannot be replayed. Both refresh and conflict rebase reject rollback, missing accepted operations, and divergent histories.

Local saves use an IndexedDB compare-and-swap transaction as well as Web Locks where available, so overlapping installed windows cannot silently overwrite each other’s queue. While visible and unlocked, the app also polls for other-device updates and reconnects on resume, even with no local changes pending. Preferences shows pending changes, the last complete copy, and any sync error with a review/retry action.

Device management, enrollment, license status, and vault archive/restore/move require a connection. Vault removal has the same online requirement as the desktop client. Move verifies the source and copies its encrypted content into the destination before retiring it; a persistent encrypted journal supports retrying interrupted copies/finalization. The source remains recoverable. Cancelling a pending action stops retries and keeps already accepted server actions/copies.

## Platform boundaries and verification

This is a web app. Native desktop integration (OS credential protection, the desktop extension connector, native drag/fill, and OS-wide password-manager autofill) is not supplied by installing the PWA. Ordinary browser extensions do not become available inside an iOS Home Screen app. Mobile OS autofill needs a native client/provider.

Background execution is not guaranteed on iOS or Android. Keep/open the app while syncing. Ask for persistent storage in Preferences; browsers decide whether to grant it. Even installed-app storage can be lost when users clear data or under browser storage policy, so retain the account-secret recovery copy. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

Automated acceptance uses a mobile-sized Chromium standalone environment with real WASM/OPAQUE, device signatures, IndexedDB, Cache Storage and service workers. It covers enrollment, offline restart, wrong passwords, password-only unlock, offline writes, multiple vaults, collections/default view, conflicts, lost-response retries, archive/restore/move, and online-only ordinary browser navigation. Run `pnpm --filter @127vaults/web test:pwa:browser` after `pnpm fixture:build` and a web build; set `VAULTS_PLAYWRIGHT_MODULE` / `VAULTS_BROWSER_EXECUTABLE` when using an external browser runtime.

Physical Safari/iOS and Android installation, airplane-mode restart, background/resume, storage persistence/eviction, clipboard permission, and app update behavior still require device acceptance before claiming full mobile release certification. Chromium emulation is not a substitute for those checks.

Deployment must serve the generated manifest, icons, service worker and the full release asset set over HTTPS (localhost is accepted for tests). The server CSP permits same-origin workers and manifests. Shell updates wait until all previous app windows close, protecting open editors and queued writes. The worker never caches API, authentication, admin, or external requests.

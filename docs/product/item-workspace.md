# Item workspace

Desktop and browser clients support an expanded sidebar or a narrow icon rail. The local sidebar preference is independent of the item list/grid preference. Icon labels remain available through hover text and accessible names. Mobile web retains its Vaults menu rather than an icon rail.

Select an item and choose **Keep in tab** to retain it in the detail pane. Each tab remembers the item's vault, including when several vaults or collections are being browsed. Selecting a tab loads the item again. Switching away from a changed editor still requires discard confirmation. Closing a tab removes that retained item; tabs are cleared when the vault locks.

**Open in window** creates a separate detail window with copy and reveal controls. The desktop uses a native Tauri window and reloads item details from the shared encrypted replica. The browser uses a popup owned by the unlocked app, updates it when the main app displays a newer version of that item, and keeps its inactivity timer active while the popup is being used. Browsers may require allowing popups for the vault origin. Reopening the same item focuses its existing window. Editing remains in the main window.

Locking the app clears desktop item windows and closes browser popups. Closing the desktop's main window locks the shared Rust session before destroying it. Closing the browser app also closes its owned popups. Item plaintext is not stored in tab preferences or included in popup URLs.

On mobile web, an opened item fills the viewport. **Close** returns to the item list, and **Vaults** opens navigation. Retained tabs reappear when item details are opened again.

## Verification

- `pnpm check:desktop` checks types, frontend/native builds, desktop tests, and Rust session tests.
- `node scripts/item-workspace-desktop-smoke.mjs` exercises the desktop React UI against synthetic IPC with its Vite server running on port 1421.
- `node scripts/item-workspace-browser-smoke.mjs` exercises tabs, popup copy/reveal/lock, independent sidebar/layout, unsaved edits, and mobile navigation inside the isolated authenticated PWA acceptance fixture.
- The smoke scripts support `VAULTS_PLAYWRIGHT_MODULE` and `VAULTS_BROWSER_EXECUTABLE` for an installed Playwright runtime/browser.
- `node scripts/item-workspace-preview.mjs` serves the saved existing build from `.tools/item-workspace-preview/existing` and the current `apps/web/dist` with synthetic review data. It exposes a desktop/mobile comparison at `http://127.0.0.1:12889`.

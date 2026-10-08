# Web and desktop workflow features

Both clients support favorites, keyboard navigation, duplicate drafts, unsaved-change protection, sync status, local password health, and TOTP authenticator codes. Existing colors are retained.

- **Favorites:** Star an item in its details, or change Favorite in its editor. Favorites lists items from all active vaults. Changes use the same encrypted save and conflict handling as other item edits.
- **Keyboard:** Ctrl/Command K or F focuses search; N creates an item; S saves the editor; Escape cancels. From search, Arrow Down focuses the first item. Arrow keys, Home and End navigate item rows; Enter opens the focused item. Preferences includes a shortcut reference.
- **Duplicate:** Creates a prefilled, unsaved draft with a new identity and “(copy)” title. Credentials, authenticator setup, custom fields and related details are retained. The copy starts without a favorite marker. Review it before saving.
- **Unsaved changes:** Switching items or vaults, creating another item, cancelling, manually locking, syncing, and closing/reloading the editor warn before discarding changed values. Automatic inactivity locking still clears unlocked data immediately. Desktop native window close uses the same protection.
- **Sync:** Desktop reads pending item and settings operations from its encrypted replica, including after restart. Both apps show the last sync and provide a visible sync/retry action. Web writes directly to the server; its unsaved editor is not an offline queue.
- **Password health:** Scans all active vaults locally while unlocked. Flags passwords under 12 characters, a small set of obvious patterns, and reuse across separate items. Includes related password fields; excludes PINs and authenticator secrets. Results contain item references and reasons, never passwords. Click a finding to open its item. This heuristic does not perform breach lookups or guarantee strength.
- **Authenticator:** Paste a Base32 setup key or an `otpauth://totp` URI in the editor. Supports SHA1, SHA256 and SHA512, 6 or 8 digits, and periods of 15–120 seconds. Codes update every second; Copy computes a fresh code at click time. Clear the setup field to remove it. Device time determines the generated code.

## Encrypted item compatibility

The reserved `__127vaults_favorite` field has type `metadata` and value `true`. The encrypted index includes the derived boolean `favorite`, allowing listing without opening item secrets. The reserved `__127vaults_totp` field has type `password`, so the CLI and native secret retrieval continue to redact it by default. Both fields remain in `customFields`, survive item-type changes, and are excluded from ordinary custom-field rendering. No database migration or plaintext server metadata is required.

## Validation

Shared tests cover all RFC 6238 Appendix B vectors for the three HMAC algorithms, time-step rollover, invalid options, field preservation and password-health findings. Web tests exercise real Rust WASM encryption, updates and copies of the new fields, plus cancelled navigation and unload protection. Desktop tests cover cancelled and accepted discard behavior and type-change preservation. Existing client tests and Rust CLI tests remain required.

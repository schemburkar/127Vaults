# Local server administration (first read-only slice)

The admin page is served at `/admin/` on the same HTTPS server as the API. Its files and route handler live under `apps/server/admin` and `apps/server/src/admin`. It has its own operator credentials, cookie, and session. Signing in here does not sign in to, unlock, or grant access to a vault. It shares the server process and PostgreSQL connection so it can report live account and device metadata; it does not need a second backend service.

The page is available only when the server is published in loopback mode. The container sees a private bridge address for the browser connection, so the handler checks the validated deployment mode; the Compose publication remains bound to `127.0.0.1`. Private-LAN deployments return `local_only` for admin routes.

## Set up a local operator

Create an operator file in the runtime directory mounted by `compose.yaml`. The first operator must be an owner. Use a long unique password that is distinct from any vault password. The generator writes only a scrypt salt and hash; it refuses to overwrite an existing file.

```powershell
$operatorFile = Join-Path $env:VAULTS_TLS_DIR 'runtime/admin-operators.json'
$securePassword = Read-Host 'New admin operator password' -AsSecureString
$env:VAULTS_ADMIN_SETUP_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
node server.mjs admin init localowner $operatorFile
Remove-Item Env:VAULTS_ADMIN_SETUP_PASSWORD
```

Restart the container so it loads the file, then open `https://127.0.0.1:12780/admin/` with the local CA trusted. In `pnpm mvp:dev`, the same URL is proxied to the containerized API. If no operator file exists, the admin sign-in API returns `admin_not_configured`; the vault client remains available.

The file format allows multiple operators with `owner` or `admin` roles. Additional entries must use unique names and the same salt/hash format. For now, these roles apply only to this separate read-only operator console. The database still has a provisional single owner and user roles for vault accounts. Ownership transfer and role mutation require a reviewed migration and permission matrix before controls are added.

## Current pages and limits

- **Overview:** Live API/database and schema checks, account and active-device counts. A review queue links directly to pending/expired invitation recipients, active devices with rotation/stale credentials, unclassified device protection and backup visibility. Backup status explicitly says `unknown` until an operator-safe backup status source is connected.
- **Users:** Search all enrolled accounts by name, username, email or account ID; filter by role and enrollment status. Results have 25, 50 or 100 rows per page, total counts and previous/next navigation. Account details show the full ID, email verification and creation time; open an account's device inventory directly. Read only.
- **Invitations:** Search recipients by email, inviter username or invitation record ID; filter pending, expired, revoked or redeemed recipients. One record can have multiple recipients. Redemption takes precedence over subsequent expiry/revocation. Details show only internal IDs and timestamps; activation links, bearer tokens and verification codes are excluded. Creation uses the existing owner onboarding workflow. Resend and revocation controls remain unimplemented in this console.
- **Roles & ownership:** Explains proposed owner/admin permissions and current limits. Read only.
- **Devices:** Search all devices by device ID, username or account name; filter by lifecycle status, protection and credential state. Inspect full device/account IDs, credential state, creation and revocation/replacement timestamps. An account-specific inventory can be cleared with **All accounts**. Revocation and reports are not implemented here.
- **Backups:** Shows the available status. Backup and restore still use the existing operator runbook.
- **Settings and audit:** Placeholders.

Operator sessions are memory-only and expire after 30 minutes or on server restart. The cookie is Secure, HttpOnly and SameSite=Strict. Sign-out requires a matching Origin and CSRF token. All admin endpoints are read-only except sign-in and sign-out. Authentication attempts have a short local rate limit. This remains experimental software for fictitious data only.

Sign-in preserves the operator name after a failed attempt and clears the password. The password visibility button and Caps Lock hint help correct entry mistakes. When the server supplies a retry delay, the sign-in button shows a countdown and becomes available when that delay ends. A request is bounded to 15 seconds; unreachable servers and incompatible responses receive clear recovery guidance.

Pages load on demand. Sort accounts by creation time or username, devices by creation time or account, and invitations by creation time, expiration or recipient email. Search applies the selected filters and order together. Clearing filters preserves your sort order and page size. Top controls can jump directly to a page; previous/next navigation is also available below the results.

**Refresh** checks the current section; failed refreshes label retained results as out of date and offer **Try again**. An expired session clears displayed directory data and returns to sign-in with an explanation. A failed sign-out leaves the console visible and says sign-out was not confirmed. The header shows session time remaining and the server address is visible in the console and sign-in screen.

Navigation supports section links such as `/admin/#users`, keyboard focus and a skip-to-content link. Narrow screens display labeled account/device cards. Details use a native modal dialog with Escape, restored keyboard focus and an ID copy action with a manual-copy fallback.

### Local browser regression

Run `pnpm --filter @127vaults/server test:admin:browser` with Playwright installed, or set `VAULTS_PLAYWRIGHT_MODULE` to a local Playwright module path. It launches headless Edge by default; `VAULTS_BROWSER_CHANNEL` can select another installed Chromium channel. Set `VAULTS_ADMIN_SCREENSHOTS` to an output directory for screenshots. The script bridges synthetic HTTPS browser requests to the real handler with disposable operator credentials and 137 synthetic accounts/devices; it never reads `.env`, operator files, or a live database.

Run `pnpm --filter @127vaults/server test:admin:database` for the actual PostgreSQL queries. It uses the cached PostgreSQL 17 image in a new, loopback-only container with in-memory storage and removes it afterward. Pass `--docker` to use Docker instead of Podman. The test covers every page, tied creation timestamps, literal wildcard text, case-insensitive search, status/role/protection filters, account-scoped devices, stale-page clamping, multi-recipient invitations and recipient-state precedence.

In hot-reload development, port `12781` is the internal backend transport, not a separate admin site. Direct browser requests to that port fail the configured Host check with `forbidden`. Use `https://127.0.0.1:12780/admin/` through the same proxy as the vault app.

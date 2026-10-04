# Local server administration (first read-only slice)

The admin page is served at `/admin/` on the same HTTPS server as the API. Its files and route handler live under `apps/server/admin` and `apps/server/src/admin`. It has its own operator credentials, cookie, and session. Signing in here does not sign in to, unlock, or grant access to a vault. It shares the server process and PostgreSQL connection so it can report live account and device metadata; it does not need a second backend service.

The page is available only when the server is published in loopback mode. The container sees a private bridge address for the browser connection, so the handler checks the validated deployment mode; the Compose publication remains bound to `127.0.0.1`. Private-LAN deployments return `local_only` for admin routes.

## Set up a local operator

Create an operator file in the runtime directory mounted by `compose.yaml`. The first operator must be an owner. Use a long unique password that is distinct from any vault password. The generator writes only a scrypt salt and hash; it refuses to overwrite an existing file.

```powershell
$operatorFile = Join-Path $env:VAULTS_TLS_DIR 'runtime/admin-operators.json'
$securePassword = Read-Host 'New admin operator password' -AsSecureString
$env:VAULTS_ADMIN_SETUP_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
node apps/server/src/admin/credentials.mjs localowner owner $operatorFile
Remove-Item Env:VAULTS_ADMIN_SETUP_PASSWORD
```

Restart the container so it loads the file, then open `https://127.0.0.1:12780/admin/` with the local CA trusted. In `pnpm mvp:dev`, the same URL is proxied to the containerized API. If no operator file exists, the admin sign-in API returns `admin_not_configured`; the vault client remains available.

The file format allows multiple operators with `owner` or `admin` roles. Additional entries must use unique names and the same salt/hash format. For now, these roles apply only to this separate read-only operator console. The database still has a provisional single owner and user roles for vault accounts. Ownership transfer and role mutation require a reviewed migration and permission matrix before controls are added.

## Current pages and limits

- **Overview:** Live API/database and schema checks, account and active-device counts. Backup status explicitly says `unknown` until an operator-safe backup status source is connected.
- **Users:** Latest 100 accounts with status, server role and active-device count. Read only.
- **Roles & ownership:** Explains proposed owner/admin permissions and current limits. Read only.
- **Devices:** Latest 100 devices with lifecycle and protection metadata. The report action is a placeholder; nothing is submitted.
- **Backups:** Shows the available status. Backup and restore still use the existing operator runbook.
- **Settings and audit:** Placeholders.

Operator sessions are memory-only and expire after 30 minutes or on server restart. The cookie is Secure, HttpOnly and SameSite=Strict. Sign-out requires a matching Origin and CSRF token. All admin endpoints are read-only except sign-in and sign-out. Authentication attempts have a short local rate limit. This remains experimental software for fictitious data only.

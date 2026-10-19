# Browser MVP walkthrough

Use only fictitious data. This walkthrough exercises basic browser onboarding
and encrypted login-item persistence; it is not a complete feature inventory or
real-secret approval. See [PWA behavior](../product/pwa.md) for installed offline use.

## Start fresh

For a disposable acceptance stack only, run from a normal PowerShell window.
The reset command deletes its acceptance database; omit it when preserving an
existing installation. Never use this walkthrough to reset customer data:

```powershell
cd C:\Projects\127Vaults
pnpm mvp:stop
pnpm mvp:reset
pnpm mvp:start
pnpm mvp:browser
```

`mvp:reset` deletes only the disposable acceptance database. Trust the printed
local CA, open `https://127.0.0.1:12780`, and keep the bootstrap code.

## Expected flow

1. **Create owner:** open *First owner setup*. Enter the code, an ASCII username
   of at least five characters, display name, valid fictitious email, a 64-hex
   account secret, and a 20+ character master password. Success says **First
   owner created**.
2. **Unlock:** use the same account secret and master password. Success changes
   the badge to **Unlocked** and displays the vault. Another browser profile
   cannot unlock because it lacks this profile's enrolled device identity.
3. **Use the vault:** create a vault, add a fictitious login item, open and edit
   it, then reload encrypted data. Each action reports a result.
4. **Verify persistence:** lock, reload, unlock again, and confirm the item.

## Troubleshooting

- A bootstrap code is single-use and expires. Run `pnpm mvp:browser` to inspect
  current state. Reset only when you intentionally want a new disposable owner.
- **No enrolled device identity** means IndexedDB was cleared or another browser
  profile/private window is in use. Enroll that new client and approve it from an
  existing trusted device. Lost-last-device recovery is a separate open gate.
- Do not bypass a certificate warning; trust the generated `127Vaults-local-CA`.
- After source changes, run `pnpm mvp:start` and hard-refresh the page.
- For a repeated failure, record the displayed stage, browser console error, and
  server log. Never share secrets, passwords, bootstrap codes, cookies, or
  ciphertext.

## Feedback checklist

- Browser/version and normal or private profile
- Step and action attempted
- Exact visible status and whether the button stayed busy
- Expected result versus actual result
- Whether retry or hard refresh changed it
- Sanitized console/server error
- Confusing wording, missing guidance, keyboard/focus, or accessibility issue

This walkthrough does not validate sharing, attachments, lost-last-device
recovery, import or production hardening. Item deletion, multi-device sync and
revocation have separate implemented paths; installed-PWA offline behavior needs
its own acceptance checks.

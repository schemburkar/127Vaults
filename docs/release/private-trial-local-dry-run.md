# Run the private trial locally

The local launcher serves the public website and real encrypted intake/trial API
at one loopback origin. Email is simulated into an encrypted local outbox; it
never contacts Cloudflare or sends a real message. Simulation is identified on
the email action and result; pages use their normal published layout.
It preserves existing requests, licenses and retained release fixtures.

```powershell
node scripts/ops/private-trial-dry-run.mjs --work C:/Projects/127Vaults-trial-delivery-20261016-a --port 12951
```

The work directory must already contain the prepared `catalogue.json`, issuer,
intake key and operator-token files. This launcher binds only to 127.0.0.1 and
requires the exact `localhost:12951` Host. Use localhost URLs, not file URLs.
The explicit loopback HTTP mode is available only in this launcher; production
intake retains its default HTTPS-only origin and Secure cookie requirements.

1. Open [Request access](http://localhost:12951/get-started.html), enter fictitious
   details (for example `friend@example.test`), accept contact consent and submit.
2. Open [Access inbox](http://localhost:12951/access-admin.html). Copy the operator
   key from `C:/Projects/127Vaults-trial-delivery-20261016-a/operator-token` into
   its password field. Approve the request and select **Send invitation (dry run)**.
   The result is explicitly simulated; the encrypted outbox stores it locally.
3. Select **Review invitation**, copy its complete private link, and open it in
   a new tab. The real package downloads, signed activation and expiry operate
   normally. The existing installed client packages do not need rebuilding.
4. For the server-installation step, use the fresh recipient instance described
   in the protected work directory's `dry-run/README.md`. It is separate from
   the earlier recipient rehearsal and begins without an installed license or
   enrolled owner. Enter its installation ID in the trial page, download the
   signed license, install it locally using the guide, and restart that server.

The private server uses HTTPS and its own CA; trust its public CA only after
comparing the fingerprint through the local operator output. No global/browser
CA trust is installed by this launcher. Browser certificate warnings must not be
bypassed. Creating the first owner and enrolling Desktop/CLI devices are manual
ceremonies after trust is established. Real invitation SMTP is not configured.

## Stop and restart

If launched in a terminal, Ctrl+C stops only the public site/API. A background
launch records its PID in the protected `dry-run/host.json`; verify its command
line is this launcher before stopping that exact process. Restarting the launcher
retains the same disposable encrypted requests and simulated email history.

From the new extracted recipient bundle directory, stop its server/database with:

```powershell
node server.mjs install stop --private-dir C:/Projects/127Vaults-trial-delivery-20261016-a/dry-run-private --compose-provider C:/Projects/127Vaults/.tools/compose/Scripts/podman-compose.exe
```

This retains its volume and identity. Never reset the database or delete queues
to repeat a trial. Use a different fictitious email for another access request;
request rate limits and one-installation activation remain active in the dry run.

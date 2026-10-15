# Selected-server ownership acceptance — October 15

Status: **API/production-crypto, selected operator browser and real stale-auth
acceptance passed; full internal release remains unaccepted.** Customer ownership
UI now also passes as described below; physical/intended-host acceptance remains separate.

The isolated installation `98027ac4-9882-42d5-812a-a18c972c299f` at
`https://127.0.0.1:12898`, project `vaults-test-632a4442dfd2`, ran selected server-e
(`ee83e2d1363fccdd4d031e6cf3cd928b1ef7d361`, image
`8caae90f069a8d91d29a29b520f7c22b722bb08a80e3b177bf0b7f2bf448eddc`).
The test used real TLS, PostgreSQL, OPAQUE registration/login, signed activation
and device proof. The new fictitious member was created through invitation and
email verification; no account or session database seeding was used for it.

Verified behavior:

- The sole active owner cannot be suspended or demoted. Direct promotion through
  `role.set` is refused. An admin operator cannot request or inspect ownership.
- Invitation creation replays the same receipt. The local TLS SMTP capture
  receives the verification code; actual onboarding completion activates the
  member, which logs in through the production authentication ceremony.
- Cancelled grants and acceptance by the wrong account fail. The recipient can
  accept; its old session is invalidated. After fresh login, the identical
  acceptance request replays its receipt.
- Ownership gives no access to another account's private vaults: the member's
  directory remains empty and the original owner's destination remains denied.
- Demoting the original owner invalidates its session while preserving its five
  directory entries and the exact nine-item destination ciphertext catalogue.
  The selected Windows CLI-a (`600f206`) independently decrypts the reserved copy
  and ordinary/custom secrets while that account is a user. The sole remaining
  owner still cannot be suspended; the demoted account cannot invite users.
- The original owner is restored through a second accepted ownership request.
  The member is demoted to user and cannot invite users. Accepted/denied audit
  events exist and omit invitation tokens, operator passwords and email codes.

The initial SMTP 503 was fixture wiring: a separate container's loopback listener
was unreachable from the server despite pod membership. Running the guarded TLS
capture inside the owned server container resolved it. This was not classified
as a product SMTP defect. No external mail was sent, trust checks were not
disabled, and no product runtime or selected artifact changed.

Retained evidence is under
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a`:
`ownership-evidence.json`, `ownership-combined-evidence.json`, and
`ownership-member.json`. The local `run-ownership-local.mjs` records the executed
orchestration, including the temporary SMTP Compose wiring and cleanup. Its
capture runs the repository helper with paths mapped to existing container TLS
and writable runtime mounts. The repository acceptance helper refuses to
re-provision an already activated fixture; do not blindly rerun onboarding or
reset the database. Private failure diagnostics and mail captures remain local.

Read-only evidence/cleanup verification:

```powershell
node scripts/internal-ownership-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a
```

The initial three helpers pass Node syntax checks. The verifier passes selected Windows
CLI manifest/hash validation, byte-for-byte restoration of Compose, manifest and
environment, bundle verification, stopped isolated project/absent mail sidecar,
original 12892 server/database health, and unchanged revoked-device D journal
and pending request. The fixture retains the new member as a user with no vaults;
its empty directory can support later UI lifecycle checks without resetting the
original owner's exhausted directory slots.

Pending: external SMTP and
intended-host operations. Broader move UI/writer pairings, Windows physical
installation/keyring/CA/OS-lock acceptance, actual PWA install/update, extension
permissions/pairings and other gates in the release audit remain open. The
earlier Windows launch-policy cause is still unproven; no permission setting or
alternate Windows GUI launch was attempted here. CLI-a/Desktop-c rebuilds are
already selected from earlier work; no new product fix required another rebuild
in this run. No remote push.

## Actual selected admin-console browser

The selected server/admin-e console also passes in headless Linux Chromium using
its actual served assets and API. A strict fixture-CA Node HTTPS relay carries all
requests; no response/API fixture or disabled certificate verification is used.
The owner operator requests ownership for the enrolled member, confirms success,
cancels through Roles & ownership, refreshes and sees no pending requests. Both
confirmation passwords are cleared.

Attempting to suspend the sole owner displays the specific last-owner explanation.
The password is cleared and retry remains enabled; a second submission reuses the
same request ID and again receives 409. Audit shows request, cancellation and
suspension events. A 390px viewport has no document overflow. A separate admin
operator context has no ownership-request action for the member and no suspension
or elevated-role-removal actions for the owner. No browser page errors occurred.

Evidence: `ownership-admin-browser.json` beside the existing retained evidence.
Runner: `run-ownership-admin-browser.mjs`; repository check:
`scripts/internal-ownership-admin-browser.mjs`. The request is cancelled; no account
role or vault content changes in this browser phase. Physical Windows browser,
customer acceptance UI and intended-host operator checks remain separate.

## Real elapsed stale-authentication boundary

The member authenticated through production OPAQUE/device proof, then retained its
actual session for 310 seconds. No clock or database timestamp was changed. The
aged session still listed its pending ownership request, but acceptance returned
HTTP403 `fresh_auth_required`. Fresh authentication then accepted the identical
previously denied request ID. The member was demoted back to user and logged in
again with its empty private directory intact; the original owner was untouched.

Evidence: `ownership-stale-evidence.json`; retained orchestration:
`run-ownership-stale.mjs`. Repository helpers: `internal-ownership-client.mjs` and
`internal-ownership-stale.mjs`. The fixture was stopped after completion. This
proves the actual server boundary and API recovery, not the customer UI toast.
All new/updated helpers pass syntax checks. Combined verification including both
new phases and cleanup:

```powershell
node scripts/internal-ownership-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a --with-browser --with-stale
```

## Actual customer ownership UI

Selected web-e now passes ownership acceptance through the actual ordinary-web
UI in headless Linux Chromium. Its retained profile uses a genuinely generated
nonextractable browser key, approved by the existing member device with a signed
request and possession-proof completion. No browser keys or sessions were seeded.
The request appears in Settings → Devices after real browser OPAQUE unlock.
Cancel sends no acceptance. Confirm sends exactly one HTTP200 acceptance, locks
the app and shows the success toast. Fresh unlock succeeds, the accepted request
is absent, the private directory is still empty, and the final Lock control works.

Cleanup uses the operator API to restore the member to user, then reads the live
account directory to verify member=user and original account=owner. The retained
runner exits successfully after stopping the isolated project. Evidence:
`ownership-customer-device.json`, `ownership-customer-browser.json` and
`ownership-customer-cleanup.json`. The profile and failed diagnostics are retained.

The initial failures were test-driver issues: new-device registration was checked
before the username step; a retained service worker intercepted requests before
the strict-CA relay; and extension/sync diagnostic state was unsuitable for the
empty-directory/lock UI assertions. The final check uses actual vault visibility
and the displayed Locked/Unlocked state. Service-worker requests are explicitly
bypassed for this ordinary-web test; no CA checks are disabled and no installed
PWA/update claim is made. The customer stale-authentication toast remains separate
from the already verified real server boundary. No product runtime changed.

```powershell
node scripts/internal-ownership-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a --with-browser --with-stale --with-customer
```

## Actual stale-auth customer guidance and recovery

The retained ordinary-web profile also passes the stale-authentication UI case.
The real browser session aged **310,024 ms** without clock or database timestamp
changes. Harmless visible Refresh devices clicks prevented the independent idle
lock without reauthenticating. Ownership confirmation returned HTTP403
`fresh_auth_required`; the UI displayed exactly “Lock and unlock again, then
accept this request within five minutes.” The app stayed unlocked and retained
the pending request. Visible Lock, fresh OPAQUE unlock and confirmation then
returned one HTTP200 acceptance. The usual acceptance lock/success toast, fresh
unlock, absent accepted request, empty private directory and final Lock passed.

The UI creates a new request ID for the post-unlock confirmation. Same-ID recovery
after fresh authentication is proved separately by the API elapsed-time case.
No root/session/key data was injected and service-worker/physical-PWA limits from
the earlier ordinary-web case still apply. No product runtime/artifact changed.

Evidence: `ownership-customer-stale.json` and
`ownership-customer-stale-cleanup.json`; retained runner:
`run-ownership-customer-stale.mjs`. The repository customer-browser helper accepts
`--stale-auth`. The interrupted parent left the owned server running after test
and role-cleanup evidence had been written. On continuation, no runner/browser
process remained; roles and original catalogue were rechecked through actual
authenticated APIs (`ownership-customer-stale-live-recheck.json`) before stopping
the isolated project. Member=user, original account=owner, five original vault
entries and nine destination items remain. This recovery did not restart a live
test or change the original 12892 installation.

Syntax and combined evidence verification pass, including exact bundle/wiring
restoration, selected CLI hashes, original server/database health, absent owned
browser/mail containers and the revoked device D journal/pending request:

```powershell
node scripts/internal-ownership-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a --with-browser --with-stale --with-customer --with-customer-stale
```

Ownership software integration covered here is now verified across the selected
server, operator console, ordinary web UI and independent CLI reader. This does
not close the broader move/UI pairing, physical installation, installed PWA,
extension permission, external SMTP or intended-host operational release gates.
Internal release remains unaccepted. No push.

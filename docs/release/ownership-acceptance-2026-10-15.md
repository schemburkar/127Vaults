# Selected-server ownership acceptance — October 15

Status: **API/production-crypto, selected operator browser and real stale-auth
acceptance passed; full internal release remains unaccepted.** Customer ownership
acceptance UI and physical/intended-host acceptance remain separate.

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

Pending: customer ownership acceptance UI, external SMTP and
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

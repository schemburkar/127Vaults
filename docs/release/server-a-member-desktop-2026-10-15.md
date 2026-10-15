# Selected server-a member Desktop/native round trip — October 15

Selected Linux Desktop-c (`4e1e146`) now passes actual member UI read/edit and
Windows CLI-a (`600f206`) interoperability against selected server-a (`cbb1be0`,
image4bfc4bf6). Full internal release remains unaccepted.

Setup deliberately copied the retained genuinely enrolled Linux member CLI profile
to a new guarded Desktop profile. It uses the same Linux device/key in the normal
private test Secret Service keyring, not a newly enrolled Desktop device. The
original CLI profile is retained. No cache/key/session was fabricated; this is
explicitly an existing-profile interoperability test, not Desktop onboarding or
physical installation acceptance. Do not run the original CLI and copied Desktop
profile concurrently. Before a later offline CLI writer, perform an online
sync/checkpoint first, since Desktop has advanced that shared device's operation
history; never reset the profile to make an offline phase pass.

The exact extracted Desktop executable matches `usr/bin/vaults-desktop-poc` from
the selected immutable Deb (SHA256
`499f6584e11a55843c0b58da5be34e3ce7a2cdf507cd007df49b314947d46ff0`).
Its actual packaged webview DOM/React handlers and native backend passed:

1. Member username/account-secret/master unlock, Settings → Profile display of
   exact enrolled Linux device and Online connection.
2. Unique moved-login selection and exact ordinary fields, password masked.
3. Explicit password reveal/remask through actual buttons, without clipboard use.
4. Actual Edit/Save changes the moved login title and ends with zero queued edits.
5. Actual Lock clears the unlocked view; app/inspector process exits.
6. Independent selected Windows CLI on a different genuine device syncs and reads
   that exact changed title and ordinary fields, masked/explicit password, then
   restores original title/username normally. It verifies six destination items,
   preserved historical peer edit, retired-source edit refusal and empty review.
7. A newly launched Desktop process reopens the retained copied profile, unlocks
   Online and independently reads the restored original fields/password. It again
   reveals/remasks, verifies zero queued edits and locks/exits.

No direct native invoke, command mocks, synthetic UI response or forged operation
was used. Title changes remain normal accepted history; no item/vault was created
or deleted. Source retirement, six-item member destination and historical peer
edit remain intact. Nothing was copied to the clipboard.

Retained Desktop profile:
`/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/gui-member-server-a-20261015-a`.
Do not overwrite/recopy it after use. Initial runner refuses existing successful
phase records/profile; later work must inspect/reuse current state. Separate GUI
read/write shell scripts and app logs are retained in the selected candidate lab.
The app runs in a private D-Bus test-keyring session; no Windows GUI policy or
native registration is changed.

Evidence under
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a`:
`member-desktop-native-writes.json`, `member-desktop-native-combined-evidence.json`.
The runner asserts actual selected server image before work and checks selected
Deb/executable equality before each app launch. Final verifier independently
rechecks Deb binary hash, copied device binding, empty Desktop replicas and no
member Desktop process. All existing member/native/web/P1/extension-negative and
both offline conflict records pass; original server healthy, owned project
stopped and revoked-D encrypted draft/journal unchanged.

```powershell
node scripts/internal-member-acceptance-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a --desktop
```

New/changed helper syntax and combined verification pass. No runtime artifact
changed and nothing pushed. GUI conflict/multiple-pending/interruption/typed and
settings pairings, current Windows GUI, affirmative extension access, physical/
installed-PWA/keyring/OS-lock and intended-host operations remain open.

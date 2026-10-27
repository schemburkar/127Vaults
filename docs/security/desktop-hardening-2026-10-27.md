# Desktop hardening, 27 October 2026

Internal remediation and verification record; no package was published or installed.

## Changes

- Explicit lock revokes reused, owned and pending connectors for the current
  profile. Connector startup, session commit and revocation share a transition
  gate so a canceled unlock cannot create a surviving connector.
- Native sessions enforce a 30-minute monotonic inactivity lease independently
  of connector availability. Protected reads reject expired leases; real input
  in main and detached windows refreshes activity. Expired activity cannot revive
  the lease. Native revocation emits its event before waiting on session logout.
- Generic renderer secret reads reject the reserved passkey key ID and its
  case-insensitive label aliases. Decrypted conflict results remove that key
  field recursively. Trusted Rust passkey operations and key preservation during
  edits retain their existing paths. Lock also clears UI conflict comparisons.
- Copy uses a native clipboard lease with a 30-second deadline and native
  window-destruction/lock cleanup. GTK tracks ownership through its data provider;
  Windows tags each copy and checks that tag before clearing. Newer unrelated
  clipboard content is preserved. Windows copies opt out of clipboard history
  and roaming. Failed Windows cleanup remains eligible for retry. Third-party
  clipboard managers are outside the vault's storage boundary.

The native clipboard implementation covers Windows and Linux. Other platforms
return an unavailable error rather than falling back to untracked secret copies.

## Verification

All target execution used read-only sources/toolchains, empty allowlisted
environments, no external network, bounded writable scratch and process/resource
limits. Only synthetic secrets were used.

- Desktop TypeScript check and production frontend build passed.
- All 51 desktop UI tests passed, including native-copy routing and lock cleanup.
- Six native policy tests passed, covering reserved keys/aliases, nested conflict
  output, connector ownership, idle expiry and stale session epochs.
- The native GTK clipboard test passed separately under isolated Xvfb, including
  detached-window cleanup and preserving replacement clipboard text.
- All 123 enabled CLI library tests passed. One existing live TLS/server fixture
  remains opt-in and was not run.
- The Windows clipboard module passed an offline compile check against the
  cached Windows MSVC standard library and Windows API crate. This is not an
  installed Windows GUI/clipboard acceptance run.

`scripts/desktop-security-prepare.sh` stages a source copy and bounded tmpfs on
the existing Linux development host. Set `VAULTS_SOURCE` to the repository and
run preparation as root. Set `VAULTS_SECURITY_WORK` to the returned directory,
then run `desktop-security-native.sh` and `desktop-security-ui.sh` as the normal
development user. The scripts use that host's existing Rust/Node/dependency caches
and never install dependencies. Native checks intentionally leave the Xvfb test
ignored until executed on an isolated display.

For the Windows module check, stage cached standard libraries and crate archives
with `desktop-security-windows-prepare.sh`, setting `VAULTS_WINDOWS_STD` and
`VAULTS_WINDOWS_CARGO_CACHE`; run the native check with
`VAULTS_NATIVE_CHECK_MODE=windows`. Finish by running the preparation script's
`--cleanup` mode as root with the same `VAULTS_SECURITY_WORK` value. Check receipts
are recorded in `desktop-hardening-verification.json`.

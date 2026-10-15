# Create-ID collision: real encrypted component preservation — October 15

The queued-create collision branch now has a focused regression using real native
signed encrypted requests and an authenticated peer item at the same reserved ID.
It passes without changing production code. This is source/native Session
component evidence, not a packaged CLI/GUI or live PostgreSQL collision pass.
Full internal release and the broader collision matrix remain unaccepted.

The test reuses the real cryptographic queue helper from the missing-item follow-up.
It makes two actual offline native creations and retains their original complete
pending requests. Only the first is deliberately quarantined as stale in this
component setup. Production crypto creates a different peer item at that exact
first UUID in an authenticated catalogue; the sibling ID remains a separate draft.
A controlled HTTP fixture serves that encrypted snapshot/body and history response.
The fixture models the state boundary; it does not seed or edit a retained server.

The actual native code proves:

- Hydration verifies the catalogue/body. Automatic non-overlap rebase returns zero
  rebases and identifies `create-id-collision` rather than replacing the ID,
  updating the peer item or retiring the local creation.
- Both original signed encrypted pending requests remain exact. Verified comparison
  returns the peer title/password; the separate original local draft remains
  decryptable with its different password. Neither version is silently selected.
- Explicit server selection refreshes verified state and retires only the selected
  colliding creation. The sibling request remains byte-identical and decryptable;
  peer encrypted records remain unchanged and normal item/password reads return it.
- Every HTTP request in the fixture is GET. Classification/comparison/selection of
  server copy do not upload the conflicting creation or overwrite peer content.

No conflict, remote HTTP response or metadata is claimed to originate from the
production server: this is an explicitly controlled component fixture, with real
crypto and actual Session functions. No private account/profile/volume or original
queued request was modified by the test. Test-only temporary profiles are removed
by the existing fixture convention after successful checks.

Checks passed:

```powershell
cargo test --locked -p vaults-cli --lib create_id_collision
cargo fmt --all -- --check
cargo clippy --locked -p vaults-cli --lib --tests -- -D warnings
```

Focused result: 1 passed, 83 filtered. Only `#[cfg(test)]` coverage changed; the
selected CLI/Desktop/runtime artifacts are unchanged and no rebuild is claimed.
The release-gap audit revalidates selected artifacts/scoped runtime evidence and
preservation separately; it does not turn this component result into full release
or all-client acceptance. No P1 runtime failure was reproduced in this branch.

Remaining work includes packaged/UI collision and larger chained pending/loss
combinations using a suitable fresh controlled fixture, plus GUI missing-item
coverage around the unsupported production delete boundary. Next useful local
runtime gate is the selected package/UI encryption-session-budget message and
fresh-unlock/retry recovery. Preserve real budgets and queued work; do not lower
the production limit or reset a profile to make that case pass. Other settings,
license, client/physical/access/intended-host gates remain open; no push.

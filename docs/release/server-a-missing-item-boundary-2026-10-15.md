# Missing-item defensive coverage and current deletion boundary — October 15

The proposed live missing-edited-item scenario exposed a capability boundary:
current selected private-vault API/CLI has no supported item-deletion operation.
No sentinel was created, deleted or removed through SQL/history manipulation.
Missing-item GUI acceptance remains unproven; this finding is not a waiver and
not a claim that defensive handling is unnecessary.

## Selected-runtime capability evidence

Actual selected server-a (`cbb1be0`, image4bfc4bf6) was started only in the owned
12898 project. The original genuinely registered member authenticated through
production OPAQUE/device proof and sent an authenticated, CSRF-valid DELETE to a
fresh absent UUID under its owned synthetic destination vault. The private-item
route returned HTTP405 `method_not_allowed`. Returned catalogue/indices and signed
history snapshot were exactly equal before/after, with all six member items
retained. Exact selected Windows CLI-a (`600f206`) binary hash was checked; actual
`item --help` exposes list/get/create/edit and no delete/remove command.

An initial probe needed an explicit Content-Length for its DELETE `{}` body;
the helper was corrected before the successful JSON response check. Failed
private diagnostic is retained. This is HTTP test-helper framing, not a product
mutation or a confirmed runtime defect. The signed-history protocol enum includes
`item.delete`, but that does not establish a supported catalogue/body deletion
transaction. Appending a standalone history marker or removing SQL rows to force
a classifier would misrepresent an enabled client operation; neither was done.

Record: selected candidate work `item-delete-capability-boundary.json`.
Runner: `tests/internal/sync/item-delete-boundary-run.mjs` starts/asserts selected
image, performs the refused-method probe, stops only the owned project and runs
the existing scoped release-gap/preservation checker. It passed. No browser
permission, GUI profile or native registration is changed.

## Stronger encrypted component regression

The older missing-server-item test stored placeholder pending request data. A new
adjacent regression now generates real cryptographic private-item records and
uses actual native offline `item_upsert` to produce two signed encrypted pending
requests. It tests both first-request kinds: new creation and existing-item edit.
A controlled authenticated empty-catalogue HTTP fixture models absent server state;
the test explicitly quarantines the requests. This is a native Session component
fixture, not a real production deletion or actual GUI path.

For each kind it proves:

- Verified comparison identifies queued creation versus missing edited item,
  reports no server copy, sends only GET requests and preserves both original
  encrypted requests exactly.
- The selected draft remains genuinely decryptable with its original password.
- Explicit server/discard resolution refreshes verified server state and removes
  only the selected request. The sibling request and conflict remain exact and
  decrypt to the original sibling title/password afterward.

Executed checks pass:

```powershell
cargo test --locked -p vaults-cli --lib missing_server_item
cargo fmt --all -- --check
cargo clippy --locked -p vaults-cli --lib --tests -- -D warnings
```

Focused tests: 2 passed, 81 filtered. The new regression loops over create/update
and uses no placeholder request ciphertext. A fixture setup helper keeps the test
within strict lint limits. Production code is unchanged: this Rust file is included
only under `#[cfg(test)]`; no artifact rebuild or package selection changed.

All current selected artifacts/scoped evidence and stopped operational volumes
verify through the existing audit helper. Original server 12892 remains healthy,
owned 12898 stopped and revoked-D encrypted request/journal exact. No new catalogue
item, data/profile reset, standalone fake deletion or remote push occurred.

The original missing-item requirement stays open for applicable GUI/defensive
coverage. Plan that fixture explicitly around the current capability boundary;
do not add a new deletion product feature or mutate retained proof data merely to
manufacture a passing end-to-end test. Other local collision/chained pending,
settings/license/budget and client/physical/access gates remain available.

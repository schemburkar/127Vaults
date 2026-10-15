# P1: web move destination-copy integrity — October 15

Status: **resolved in selected server/web/admin internal-20261015-a**, source
`cbb1be0`, by targeted immutable-package live refusal/cancel, valid move,
independent data-preservation and cleanup checks. Full internal release remains
unaccepted; the broader matrix is still open.

A copied destination item can change after its create was accepted but its reply
was lost, or after the client has recorded that mapping. The selected web client
verified the saved request signature and replayed it, but skipped comparison of
the current destination contents. It could then construct finalization using a
newly read destination catalogue revision. The server checks catalogue revisions
and mapping existence, so those checks do not establish that the copy still
matches the source. Code inspection therefore identifies unreviewed source
retirement as a risk. This is not a claim of permanent ciphertext loss: retired
source records remain retained.

The focused regression failed on the original implementation: a peer-edited copy
caused an unexpected write instead of REMOVAL_DESTINATION_CHANGED. This is a
source-level regression reproduction, not yet a live selected-browser destination
edit reproduction. Earlier live normal/copy-loss/finalization/source-change cases
remain valid within their recorded scopes; they did not test this condition.

The fix decrypts and semantically compares complete source/destination index and
body JSON, including passwords and custom fields. It checks an already accepted
pending copy before replay/journal advancement, checks recorded mappings, and
checks all copies again before constructing the final request. Missing or edited
copies refuse with journal preservation and explicit review guidance. Finalization
uses the exact compared catalogue revision; a later write therefore produces the
server's BASE_CHANGED rather than being silently adopted.

Saved final requests from older clients are also validated when the source is
still active. Already-retired sources keep exact receipt replay. Comparisons use
JSON values rather than object-property order, allow unrelated destination items,
and wipe temporary decrypted byte arrays. Real Rust-WASM coverage verifies valid
copy comparison, changed custom secrets and continued usability of caller handles.

Validation:

- Focused lifecycle tests: 12 passed (originally five existing cases; first new
  regression was observed failing before the fix).
- Full web suite: 72 passed, zero skipped/failures.
- `pnpm --filter @127vaults/web check`: TypeScript, production Vite/PWA build and
  configured JavaScript syntax checks passed.
- Regression cases include pending and mapped-copy edits/deletion, title/password/
  custom-secret divergence, re-ordered equivalent JSON, unrelated additions,
  post-receipt changes, late destination races and active-source legacy requests.

The new server/web/admin candidate is built and verified as recorded below. Next:
exercise real destination-copy editing and UI refusal/journal preservation against
that immutable package. Recheck valid normal and interrupted move paths
with the new package. Preserve the existing five-slot member fixture and all
historical source/copy records; reuse suitable active data or create another
isolated account/lab. CLI/Desktop selections need no rebuild for this web-only
change. No selected artifact was changed or remote push performed in this run.
Other release matrix and physical/intended-host gates remain open. Internal
release remains unaccepted.

## Immutable candidate built; live acceptance pending

`server/internal-20261015-a/linux-amd64` is built from committed
`cbb1be02e68e484c82334cd4389dcc4b09f64cf2` with all release gates passed. Full
archive/file hashes and named checks are in
[the candidate record](server-candidate-2026-10-15.json). The server image is
`localhost/127vaults-server:release-21caa965329aa478`, ID
`4bfc4bf6344f20efcb574501aca5c6f212d3ffdc752892867b504b74a8939a27`.
Manifest/hash and local image-ID verification pass. At the build checkpoint this was not yet selected; the artifact inventory was
updated only after the targeted live acceptance below passed.

A separate extracted fixture and genuine copied enrolled browser profile are at
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a`.
The same owned installation ID/origin/volume will be used, preserving its original
fixture directory, old bundle and records. New extracted Compose wiring injects
PORT=12898 and maps its internal port accordingly; its local manifest checksum is
verified. The pristine archive uses the image default port rather than an explicit
PORT line: the first preparation assertion stopped before starting anything, and
preparation resumed safely from the retained extracted directory.

At the preparation checkpoint the project was stopped and live acceptance had not run.
Original 12892 server/database remain healthy. Next retained commands:
`node <candidate-work>/run-destination.mjs loss`, then
`node <candidate-work>/run-destination-peer-edit.mjs`, then
`node <candidate-work>/run-destination.mjs guard` and `abort`. These test-helper
destination branches are syntax checked and staged for the live run, not passing
UI evidence yet. They explicitly reuse the active guard source, avoiding any reset
or sixth vault. The candidate runner asserts its server image ID before browsing.
After refusal/cancel, establish a separately recorded valid move attempt on the
new package while preserving the edited historical copy; also exercise applicable
interrupted paths. Only then update artifact selection and close this blocker.
CLI/Desktop selections remain unchanged. No push.

## Packaged live acceptance passed and selection updated

The runner asserted actual server image ID 4bfc4bf6 before each browser phase.
Actual selected web controls reused the active guard source, made a real copy
whose accepted response was discarded, and retained its complete journal. A
different registered device made a real signed edit to that destination item.
Resume showed the specific destination-copy guidance, sent no copy or removal
retry and preserved the exact journal. Explicit cancellation kept both source and
edited copy. No user/device/account/session data was seeded or reset.

A separate explicitly confirmed move attempt then copied the source into a new ID
and retired it successfully. The first read assertion matched both the new title
and the edited historical title because it used a substring selector. A read-only
completion phase selected the exact title, recovered the accepted request IDs from
the retained failed diagnostic, and verified fields/masking/reveal/lock without
repeating the move or recreating its source. A mode-flag error in that read driver
was corrected before it ran successfully. Failed diagnostics remain retained.

A different registered-device crypto reader independently decrypted retired source
and new copy, verified five directory entries and six destination items, all five
prior item IDs, and the edited historical copy title still unchanged. The new
normal move did not silently overwrite or revert the peer edit. This is a source
production-crypto reader, not a packaged CLI/Desktop peer claim.

Candidate records: `web-move-destination-{loss,peer-edit,guard,abort}.json`,
`web-move-candidate-normal.json`, `web-move-candidate-peer.json` and
`candidate-combined-evidence.json` under the separate candidate work directory.
The owned project is stopped, candidate extracted wiring/manifest match their
snapshots, original 12892 server/database remain healthy, and revoked D pending
request/journal remain exact. All six selected artifact sets pass manifest/hash
verification. The artifact inventory now selects server/web/admin
`internal-20261015-a`; old server-e is retained as historical evidence.

```powershell
node scripts/internal-server-candidate-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a
```

Use the candidate work directory for future new-package acceptance; the original
lab fixture.json still names the old bundle for historical cases. Member now has
five retained entries, four moved sources and one active destination with six
items. Older fixed-count live phases must not be rerun blindly. Broader new-package
interruption/cross-client, typed/settings, Windows/installed-PWA/extension and
intended-host gates remain separate; passing this P1 does not accept the full
release. CLI/Desktop selection is unchanged. No push.

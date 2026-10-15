# P1: web move destination-copy integrity — October 15

Status: source fix, local checks and immutable candidate build passed. Selected
server/web-e still lacks the fix. **The release blocker remains open until the
new candidate passes packaged live acceptance.**

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
Manifest/hash and local image-ID verification pass. This remains a candidate; the
selected artifact inventory was not changed ahead of live acceptance.

A separate extracted fixture and genuine copied enrolled browser profile are at
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a`.
The same owned installation ID/origin/volume will be used, preserving its original
fixture directory, old bundle and records. New extracted Compose wiring injects
PORT=12898 and maps its internal port accordingly; its local manifest checksum is
verified. The pristine archive uses the image default port rather than an explicit
PORT line: the first preparation assertion stopped before starting anything, and
preparation resumed safely from the retained extracted directory.

The project is still stopped; no new-candidate browser/API acceptance has run.
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

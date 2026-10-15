# P1: web move destination-copy integrity — October 15

Status: source fix and local checks passed; selected server/web-e still lacks the
fix. **The release blocker remains open until rebuilt-package live acceptance.**

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

Next: rebuild and verify a new server/web/admin release from the committed fix,
then exercise real destination-copy editing and UI refusal/journal preservation
against that immutable package. Recheck valid normal and interrupted move paths
with the new package. Preserve the existing five-slot member fixture and all
historical source/copy records; reuse suitable active data or create another
isolated account/lab. CLI/Desktop selections need no rebuild for this web-only
change. No selected artifact was changed or remote push performed in this run.
Other release matrix and physical/intended-host gates remain open. Internal
release remains unaccepted.

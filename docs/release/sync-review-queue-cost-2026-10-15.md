# Growing queue review cost

Inspection after the interrupted 298-edit GUI budget rehearsal found that
`Session::sync_review` reloaded the complete replica twice per queued request,
through `decrypt_item_parts` and `open_vault`. Desktop refreshes sync review
after saves, so growing queues caused repeated full-file parsing within each
review. This is a concrete avoidable cost; it is not proof that this explains
every observed GUI/inspector delay.

Review now opens each nonempty vault once per review and reuses that key while
authenticating every original index/body and base index/body. It does not cache
decrypted drafts across calls or alter requests, budget limits, conflict choices,
or verification. Other callers retain the existing opening/decryption path.

Validation: CLI library suite: 84 passed, one live TLS/PostgreSQL fixture test
ignored under its existing explicit fixture requirement. The new real-encryption
66-request regression verifies labels, changed fields, secret redaction and exact
request preservation, then corrupts a middle ciphertext and verifies review
refuses it without changing the queue. CLI library/test Clippy with warnings
denied passes. Formatting passes after applying rustfmt.

CLI and Desktop runtime artifacts require rebuilding before this change can be
claimed in packaged acceptance. The original budget-limit gate remains open
until a selected rebuilt package exercises the unchanged limit and recovery.

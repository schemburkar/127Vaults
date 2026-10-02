# Browser MVP evidence

Status: implemented; final human browser ceremony pending local-CA trust.

The HTTPS app provides first-owner setup, real Rust/WASM OPAQUE login,
root-response verification, non-extractable browser Ed25519 device proof,
authenticated private-vault loading, encrypted item create/list/open/update,
reload, explicit lock, background/exit lock, and 30-minute idle lock. The trust
warning is persistent. No delete, sharing, offline, attachment, or recovery
claim is made.

Rust authenticates PVD1 before selecting a vault and verifies the selected
envelope digest, context, and key wrapping. PVM1 and item commitments are
verified while decrypting the lightweight index and on-demand body. Account
secret, master password, plaintext item fields, and root/vault handles are not
stored. IndexedDB contains only public identity labels and a non-extractable
software device-signing key; the session cookie is secure and HTTP-only.

Automated evidence:

- Rust private-vault reopen/tamper test passes.
- strict Rust Clippy and browser WASM build pass.
- server suite passes 18/18; server and browser JavaScript syntax passes.
- `pnpm mvp:assets` verifies HTTPS, CSP, no-store HTML/JS/WASM delivery.

The Codex in-app browser correctly refused the locally generated CA with
`ERR_CERT_AUTHORITY_INVALID`; bypassing that warning was not attempted. A human
must explicitly trust the generated local CA before the final browser ceremony.

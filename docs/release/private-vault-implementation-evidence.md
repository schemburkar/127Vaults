# Private-vault implementation evidence

Date: 2026-09-09. Fictitious data only. Batch 7 is in progress.

Implemented:

- exact PVD1/PVM1 Rust encoding, HKDF/HMAC authentication, sorted entries,
  bounds, scope checks, constant-time tag verification and tamper vectors;
- Rust/WASM-only vault/item IDs, revisions, vault keys, ECF1 encryption,
  catalogue composition and commitment-checked part decryption;
- PostgreSQL directory, vault, item, receipt and metadata-only audit schema;
- authenticated HTTPS create/list/read/update routes, strict public record and
  ECF1-context validation, expected bases, transactional publication,
  account ownership, idempotent request fingerprints and lock deadlines;
- registration can publish the authenticated empty directory in the same
  transaction and its digest is bound by the first-device activation signature;
- a minimal web transport retains proposals only after a successful response
  and invalidates late results and key handles on lock.

Evidence passed: strict workspace Clippy, eight Rust tests, workspace Rust tests,
WASM target build, 18 server tests, and server/web JavaScript syntax checks.
The known TypeScript executable ACL still blocks `check:contracts` before it can
run.

Live loopback Node/WASM-over-HTTPS evidence covers authenticated vault create,
idempotent replay/divergent reuse, item create/list/open/update, decrypted index/
body comparison, stale-base rejection and lock invalidation. Parallel requests
proved identical replay, one-winner competing updates, and invalid-pair rollback.
PostgreSQL/log inspection found no known fictitious secret markers.

Two-account isolation passed. Real authenticated browser execution/reload remains;
the Node-target WASM acceptance is not browser evidence.

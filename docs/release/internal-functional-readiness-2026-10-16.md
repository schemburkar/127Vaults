# Internal release: accepted for local code and basic functional checks

The user confirmed that item deletion is required, then explicitly said installer
rebuilds are unnecessary when the feature is tested locally. Under that updated
criterion, the local implementation is accepted. Runtime feature commit:
`8d95a85229c65991f3e45b4c53a22f58f0120375`. Nothing was pushed.

Individual deletion is implemented across Core/WASM, server, CLI, Desktop and
web/PWA, including authenticated catalogues, atomic signed history and receipts,
offline persistence/retry and explicit delete-versus-edit conflict handling.
See [implementation and evidence](item-deletion-2026-10-16.md).

| Surface | Local evidence and scope |
| --- | --- |
| Server | Focused HTTP/unit checks; real PostgreSQL 17 migration and signed deletion test passed, preserving sibling ciphertext and refusing resurrection |
| Core/WASM | 19 Core tests and 1 binding test passed; rebuilt browser WASM |
| CLI | 88 tests passed on Windows and Linux, with 1 existing explicit live-fixture test ignored; both already-started CLI packages completed and verify |
| Desktop | 37 product tests plus type/build/native checks passed; confirmation, queue ownership, stale responses and removed detail handling covered |
| Web/PWA | 79 tests plus type/build checks passed; real Core offline deletion, reopened queue, exact retry and peer-edit rebase choices covered |
| Extension | Existing implementation unchanged; consumes current web/native item lists; prior extension checks remain historical, with no new host/passkey grant |
| Admin | Existing implementation unchanged; prior server-b login/list/logout evidence retained; deletion is a private-item operation |
| Public site | Existing local preview unchanged; intake/download distribution remains closed |

## Package scope and deferred follow-ups

Existing server/web-b and Desktop-e installers predate deletion. They are retained
as historical artifacts and do not represent the new feature. Rebuilding them is
explicitly deferred by the user's instruction. CLI internal-20261016-c happened
to finish before that instruction was processed; its Windows/Linux manifests and
packaged Windows deletion command help were verified. No additional build remains
running. The attempted server build ended because the release cache was busy;
no new server package was produced.

Intended-host/physical installation, CA-trust, OS-lock and SMTP acceptance remain
separate user follow-ups. The earlier Windows GUI launcher rejection has not been
diagnosed or bypassed. Optional extension/passkey ceremonies remain unclaimed.
Detailed cross-client matrix coverage is a backlog, not the current basic-sanity
acceptance criterion. This is local private experimental acceptance, with no
public deployment, signing or production-secret readiness claim.

All retained installations, queues and backups were preserved. The new disposable
PostgreSQL container was stopped after its test; no containers remain running.

## Final local recheck — October 16, 2026

Verified clean local `main` at `f720f13` before this documentation reconciliation.
No new runtime gap was established; feature implementation remains `8d95a85`.
The following existing checks were rerun and exited successfully:

- `pnpm check`: all workspace syntax/type checks, web/Desktop builds, native
  Desktop check and API contracts.
- `pnpm test`: workspace product suites, internal suite structure, startup,
  public site, deployment, operator and release checks; public catalogue valid.
- `cargo test --workspace`: Core 19, browser binding 1, CLI 88 and protocol 2
  passed. One explicitly opt-in live device test remained ignored.
- `cargo fmt --check`: passed.
- `pnpm test:internal:audit`: historical selected artifact hashes and basic
  runtime records verified. This audit does not claim those installers contain
  deletion; the focused source/real PostgreSQL evidence above covers deletion.

No new fixture scripts, installer rebuilds, permissions, deployments or remote
pushes were needed. Optional database/browser/physical checks were not repeated
by these commands. Historical pause and product-priority documents now point to
this current decision, while preserving their wider acceptance backlog.

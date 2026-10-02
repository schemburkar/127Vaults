# Disposable encrypted login-item evidence

Date: 2026-09-09. Fictitious data only.

Batch 4 adds `/login-item`, a separate loopback-only browser fixture. It uses the
real Rust/WASM ECF1 core through the serial worker and the existing 30-minute
session component. The UI creates or edits one login item, encrypts it before
`localStorage`, and persists only ECF1 envelopes/contexts, random scope IDs, a
display revision counter, and the experimental format label. Unlock inputs and
item plaintext are not fields in the stored record.

Real in-app-browser smoke passed:

1. create the prefilled fictitious item and observe ECF1 with revision 1;
2. lock and observe empty/disabled credential and item fields while encrypted
   metadata remains;
3. reload, enter the fictitious unlock pair, and recover the exact item through
   Rust/WASM;
4. edit the title and observe a replacement envelope and revision 2;
5. lock again and observe cleared fields and terminated worker key handles.

`pnpm --filter @127vaults/web check`, Rust formatting, strict workspace Clippy,
three Rust crypto tests, workspace tests, and `pnpm fixture:build` passed. The
workspace `pnpm check:contracts` still fails before TypeScript execution because
the known `node_modules` ACL denies access to `typescript/bin/tsc`; Batch 4 changed
no TypeScript files.

This is not authentication, online/server persistence, sync, sharing, recovery,
real-data approval, stable storage, or a JavaScript zeroization claim. JavaScript
strings and garbage-collected copies cannot be guaranteed erased. Production
private-vault storage remains Batch 7.

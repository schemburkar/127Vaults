# 1Password import implementation and verification

Date: 2026-10-22. Local implementation; no public release, R2 upload or Git push.

## Decisions

- Read 1PUX typed values rather than assuming the legacy section representation.
- Use existing item types where possible, add normal field-based templates for
  additional categories, and retain unfamiliar categories as Custom items.
- Keep duplicate top-level labels editable by adding numbered suffixes; preserve section field labels.
- Preserve custom sections and readable values; conceal vendor secrets and
  sensitive native fields. Never expose unknown structured objects as raw JSON.
- Preserve SSH text exactly. Private keys stay concealed; no conversion,
  reformatting, key generation or signing-agent integration is performed.
- Keep address components and phone strings without locale-based rewriting.
  Exported numeric date representations remain editable without guessing dates.
- Store TOTP setup in the existing encrypted `__127vaults_totp` field. Activate
  supported setup configurations; retain extra/unsupported strings as concealed
  custom fields and count them as lacking native behavior. No storage migration.
- In edit mode only, the authenticator setup has a Copy button and remains
  masked. Copy uses the existing clipboard workflow; code generation is unchanged.
- Explicit additional login websites participate in exact HTTPS origin matching
  in both local-agent and web extension sources. Arbitrary URL fields do not.
  Passkey origin handling is unchanged.
- Exclude archived items to avoid activating old credentials. Defer tags,
  favorites, timestamps/history, references, documents, attachments and icons.
  Recommend user-managed external document links; never upload files during import.
- Preview reports category counts, excluded items/archived items/files, and fields
  omitted or retained without native behavior. Item/file counts cover the export;
  field/type counts cover selected importable items. Reimport still creates duplicates.

## Verification

Use the existing repository scripts. Local console receipts are retained under
`.tools/verification/1password-*.log` (ignored build evidence, without user data).

- `pnpm check:desktop`: desktop TypeScript/Vite/native checks, 52 desktop tests,
  CLI library tests, and a Windows application build without an installer.
- `pnpm --filter @127vaults/web check`: TypeScript, production web build and
  JavaScript syntax checks.
- `pnpm --filter @127vaults/web test`: 90 passed.
- `pnpm --filter @127vaults/ui test`: 12 passed, including explicit setup copy,
  masked inputs, clipboard error handling, multiline preservation and RFC 6238 vectors.
- `pnpm --filter @127vaults/extension test`: 36 passed.
- `node --test public-website/*.test.mjs`: 10 passed.
- `cargo clippy --locked -p vaults-cli --all-targets -- -D warnings`: passed.
- `cargo test --locked -p vaults-cli --lib`: 112 passed, one existing test ignored
  because it requires the separate disposable TLS/PostgreSQL device-management fixture.

Import fixtures cover category mapping, source selection before capacity checks,
unknown-category fallback, concealed values, structured fields, original SSH text,
TOTP configuration validation and duplicate setups, file/archive exclusions, and
secret-free summaries. The real encrypted import path verifies passport
classification, concealed passport numbers, and intact TOTP setup retrieval.
Website tests reject unrelated document URLs, subdomains, ports and HTTP downgrades.

This verification uses synthetic exports, not a user's live 1Password account.
Existing 32 MiB import, 48,000-byte normalized record and vault capacity limits apply.

## References

- [1Password's 1PUX format](https://support.1password.com/1pux-format/)
- [1Password export guidance](https://support.1password.com/export/)
- [Bitwarden's published 1PUX type definitions](https://github.com/bitwarden/clients/blob/main/libs/importer/src/importers/onepassword/types/onepassword-1pux-importer-types.ts)
- [Migration behavior](password-migration.md)

## Final local receipts (SHA-256)

| Artifact | SHA-256 |
| --- | --- |
| `target/release/vaults-desktop-poc.exe` | `74614eed1b500a995e53e99189b915c4367f4a69ab79bab0859e23af56793701` |
| `.tools/verification/1password-cli-test.log` | `ace992d6db87ea31aa41e57282d58b0adba181ade95e43c14ceaa404ebff1200` |
| `.tools/verification/1password-clippy.log` | `d173d7df56400810fe17aff86a469d7f0d4fdd0c23eef53c8a07d4874dcd3350` |
| `.tools/verification/1password-desktop.log` | `ebef191119d1e869b6128418d59b00f426e6715929733b436a2993ba707cb278` |
| `.tools/verification/1password-extension-test.log` | `9ba588f3bf3d18178ca631b31261ceac38b92d2312dc4878c0bc8224ccb185fd` |
| `.tools/verification/1password-public-test.log` | `ff7e2da8d6481d8526bea1bdef5e5aa7eb98e93096c261badd4eb6c8d976608e` |
| `.tools/verification/1password-ui-test.log` | `f0eac0de1ee36734490a9a70171269d8938c1e7c3d75118bb27707c94d067672` |
| `.tools/verification/1password-web-check.log` | `232c08374553a07169ab3f0642a9dc55db00dbee7d14f73834657ea2c9b6b98a` |
| `.tools/verification/1password-web-test.log` | `dc5b84a14de8d7b0e0037428ce3ed27f1ab57c742a746e2149062c7d33a31a22` |

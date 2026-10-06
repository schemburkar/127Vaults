# Cross-surface MVP audit — 2026-10-06

This is a review snapshot, not a release approval. The live acceptance state is in the [component backlogs](../product/README.md) and the [release gate](beta-readiness.md). All checks below used fictitious data on the existing Windows checkout. No Mac, Linux desktop, clean host, or live cross-client session was available in this audit.

## Scope and current decision

The original internal MVP is the online web client plus one self-hosted server and PostgreSQL: owner/invite onboarding, OPAQUE unlock, one private vault, encrypted login item create/read/update, lock, and fetch after restart. That implementation exists. P0 acceptance is still open for the human browser ceremony, hostile-path evidence, rebuilt operator bundle, and requested Chrome/Edge offline read-only extension walkthrough. These are verification gaps, so the P0 cut is implemented but not accepted. A supported first release and real-secret beta are further away; the [release gate](beta-readiness.md) remains closed.

Desktop and CLI are useful experimental test devices and extension sources. They were outside the original internal MVP cut. Cloud, mobile apps, passkeys, TOTP, imports, and supported multi-platform packages are outside the current P0 cut. Shared vaults are excluded from the current product direction. The public site is a waitlist and preview, not a release channel.

## Surface consistency

| Boundary | Present | Recheck before claiming parity or support |
| --- | --- | --- |
| API and protocol | The web, CLI, and desktop use the v1 server contract; desktop reuses the CLI Rust session. `packages/api-contract` checks published routes against the canonical route list. | Live web/desktop/CLI item round trips, old item markers, unknown fields, server version compatibility, and two-device conflict/delete paths (WEB-003/005, CLI-003/004, DESK-004). The route test is an inventory check, not a behavioral conformance suite. |
| Vault data | Server keeps encrypted item and settings envelopes; desktop/CLI have encrypted replicas and queued edits. Web remains online only. | Device rotation, rollback/fork, stale checkpoints, pending queue replay, interrupted archive/move, and recovery with a restored server (SRV-002–004, DESK-008/009, CLI-009/010). |
| Extension | Explicit selected-login fill, exact HTTPS origin, and read-only native host are implemented. It can use an unlocked web tab or an installed desktop/CLI source. | Real Chrome and Edge registration, server-offline fill, source/tenant switching, OS lock, phishing/frame/site matrix, and proof that no write request occurs (EXT-001–005/007/008). The manifest description was corrected during this audit. |
| License state | Server exposes authenticated, redacted status; clients display partial experimental status. | Entitlement installation, anti-rollback, grace/lock enforcement, renewal and emergency export are unfinished (SRV-017/018, WEB-009, DESK-010, CLI-012, EXT-010). UI must not imply enforcement now. |
| Public site | Waitlist and empty signed-release catalogue exist. Shared-vault sales claims were removed and every page now carries a Cloud/release coming-soon notice, with a copy regression test. | Recheck proposed pricing, product promises and the empty downloads state before publication; Cloud and shared vaults are not supported capabilities. |

## Checks run

- `pnpm check`: passed, including TypeScript, web/desktop production asset builds, syntax checks, Rust desktop `cargo check`, and contract types.
- `pnpm test`: passed. Server 83 passed/2 skipped; web 15; desktop 10; extension 10; shared API contract 2; device lifecycle 6. The root command now also runs the public website tests and validates the empty release catalogue. Some workspace packages have no tests.
- `cargo test --workspace`: passed, including CLI 36, crypto 11, protocol 2, and browser fixture 1 tests. The desktop Rust binary has no Rust unit tests; its JS tests and shared CLI engine tests cover selected behavior.

These are local unit, syntax, and build checks. They do not prove interactive login, a native-host install, end-to-end deployment, non-Windows operation, accessibility, or security review. Keep the corresponding backlog rows open until their acceptance evidence exists.

## Desktop platform status

| Platform | Assessment from this checkout |
| --- | --- |
| Windows 11 | Development target. Tauri/WebView2 shell and shared Rust engine build locally. No supported installer, signing/update path, clean-machine run, or completed native drag safety matrix yet. |
| Linux desktop | Source includes Linux secret-service keyring support and portable paths. The CLI's 36 unit tests passed on Ubuntu 20.04 WSL2 ([evidence](linux-wsl-check-2026-10-06.md)); that distro lacks Tauri 2's WebKitGTK 4.1 development package, so no desktop build, GUI run, package, or secret-service/Wayland/X11 acceptance was performed. Potentially viable, unverified. |
| macOS | Not functional as a vault client yet. The CLI device-key store/load and desktop account-secret cache have `cfg` implementations for Windows/Linux only; the other-platform paths return storage unavailable. Enrollment/unlock therefore cannot be claimed. No WKWebView, Keychain, package, signing/notarization, or native drag test exists. |
| Other desktops/mobile | No supported target or acceptance evidence. Tauri framework support alone does not establish application support. |

The Tauri config has `bundle.active: false`, and desktop packaging is open in DESK-005. The extension's native-host installer is Windows-only; macOS/Linux registration and browser verification are separate work. The server's documented operator path covers Windows Podman and Linux Podman, with Docker and second-host testing open.

## License decision checkpoint

`LICENSE-POLICY.md` and ADR-0013 set BSL 1.1 with `AGPL-3.0-only` after a fixed date for each immutable release. There is still **no root `LICENSE` grant**. The Rust workspace declares `BUSL-1.1`, but that metadata does not supply the release-specific BSL text or permission to distribute. Keep source and artifacts private until the first public snapshot includes complete terms.

A single root BSL license can cover the owned monorepo code if its Licensed Work definition expressly covers the whole identified snapshot, including server, web, desktop, CLI, extension, packages, and site where intended. Keep third-party notices and dependency terms separately. Add directory licenses only for intentionally different grants, such as Apache-licensed interoperability material. Every public source archive and distributed binary needs its applicable notices and release-specific terms; the public release catalogue already expects a license URL per artifact.

The four-year AGPL transition is a workable delayed-open-source design, but it is a real and irreversible grant for each old version. A later version cannot postpone an earlier version's transition. After the date, compliant users can use that old version commercially without a paid production license; AGPL obligations, including network-source duties for modified server versions, apply. The project must own or have sufficient rights in all contributions to offer BSL, AGPL and commercial alternatives. Check dependency compatibility for both phases, the exact Change License choice and license text with counsel, and keep trademark, support and security-update promises separate from copyright permission. The release gate in `LICENSE-POLICY.md` remains appropriate before any public beta or public repository snapshot.

## Next acceptance order

1. Close the P0 browser/server operator and hostile-path checks with exact evidence, then the Chrome/Edge offline read-only extension matrix.
2. Choose which of desktop and CLI actually ship in the first supported release; close only the corresponding P1 packaging, device, conflict and secret-exposure gates.
3. Freeze crypto/protocol formats, complete restore and second-host deployment, obtain independent review, and prepare signed licensed artifacts before any real-secret beta.
4. Keep iOS, Android and iPad out of this MVP. Revisit native mobile clients after a supported desktop/web/extension path and a separate mobile security, platform and distribution plan. A tablet layout can follow the phone client rather than becoming a separate MVP product.

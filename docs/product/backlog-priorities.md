# Backlog priority review

Updated 2026-10-06. This is the current scheduling decision for the live [component backlogs](README.md). It does not change their acceptance states or the [release gate](../release/beta-readiness.md). The [2026-09-08 MVP plan](mvp-plan.md) remains a historical decision: its online web and server flow has been implemented for fictitious data. The user subsequently requested an offline-capable, read-only Chrome/Edge autofill connector for web, desktop and CLI; its development priority is P0, while supported release acceptance stays separate.

## Priority meanings

| Priority | Meaning | Release implication |
| --- | --- | --- |
| P0 — MVP now | Required to reproduce the operator-led web/server MVP and build the requested offline, read-only Chrome/Edge autofill extension with fictitious data. | No real-secret or public-beta claim. |
| P1 — first release | Required if the named feature or client is included in a supported first release. Work can follow the P0 cut. | Release only after its own acceptance and the common release gate. |
| P2 — later | Optional product expansion or an experiment that can be disabled without breaking P0. | Reprioritize before enabling or advertising it. |

Previously completed capability rows are recorded as **Baseline**; priority usually applies to remaining work. A completed scope decision can retain the priority of the deferred features it concerns. A P1 row can be implemented already but still need verification. A feature excluded from P0 must be absent or clearly experimental in the MVP build and documentation.

## P0 scope and order

The MVP surface is the online web app and one self-hosted server with PostgreSQL. Acceptance uses one private vault per test account and covers owner and invited-user onboarding, OPAQUE unlock, login item create/read/update, explicit lock, and authenticated encrypted persistence. Keep the web session online only. Use fictitious data and an operator-led install. Desktop and CLI can serve as test devices and extension credential sources. The extension's requested development slice is an offline-capable read-only connector with explicit selected-login fill; offline access comes from an installed desktop/CLI encrypted replica.

Current product direction excludes shared vaults and native iOS, Android, and
iPad clients from this MVP. The public site's Work vault is a second private
vault. Do not reintroduce sharing claims or mobile delivery gates without a new
scope decision.

1. **Rebuild and run the test bundle** (SRV-013): the existing Windows/Podman host passed the fresh-volume operator and verified HTTPS smoke on 2026-10-06; see [evidence](../release/server-bundle-smoke-2026-10-06.md). Clean-host and restore checks remain P1.
2. **Complete the browser ceremony** (WEB-007): trust the local CA on the intended host, enroll and unlock in a real browser, verify owner and invited-user isolation, lock and restart. Browser-native enrollment and the wider LAN matrix remain P1.
3. **Run the narrow hostile-path check** (SRV-004): wrong credentials, unauthorized account/vault access, malformed or substituted ciphertext, stale-base update and divergent request-ID reuse. Inspect requests, logs and database for plaintext or user secrets. Record evidence against the [internal MVP acceptance](mvp-plan.md#internal-mvp-acceptance).
4. **Close the operator handoff**: document the known limits, test credentials and reset procedure in the test-install runbook. Capture human acceptance of the browser walkthrough. Do not mark a broader backlog row Done from this subset alone.
5. **Complete and verify the extension slice** (EXT-001–004, EXT-007/008): hydrate a desktop/CLI replica, register the native connector, stop the server and close the web tab, unlock that local replica through the extension, fill conventional and split login forms, then check active-client handoff, lock, restart, rollback, origin change, ambiguous forms, same-origin frames and absence of writes. Keep EXT-005 packaging and distribution in P1.

P0 is complete when these checks pass and their evidence is linked from the relevant backlog rows. A failure becomes a scoped fix in that same row before moving to P1.

## Remaining work by component

| Component | P0 — MVP now | P1 — first release | P2 — later |
| --- | --- | --- | --- |
| Public site | None; waitlist stays closed in static preview | SITE-001–005, each enabled only after its own privacy, billing, artifact, or Cloud gate | None currently |
| Web | WEB-007 browser ceremony subset | WEB-003, WEB-005, WEB-007 remaining, WEB-008, WEB-009 license messaging | WEB-004 scanner verification, WEB-006 offline browser |
| Server | SRV-004 narrow hostile-path subset, SRV-013 rebuilt-bundle smoke | SRV-002, SRV-003, SRV-004 remaining, SRV-005–011, SRV-013 remaining, SRV-017/018 licensing | SRV-012, SRV-014–016 |
| Desktop | None; test device only | DESK-004–008, DESK-010 license messaging, with DESK-008 only if multiple vaults/collections ship | DESK-003, DESK-009 |
| CLI | None; test device only | CLI-003, CLI-004, CLI-006, CLI-008, CLI-009 if multiple vaults/collections ship, CLI-012 license status | CLI-007, CLI-010, CLI-011 optional table output |
| Browser extension | EXT-001–004 and EXT-007/008 offline, read-only development and browser walkthrough | EXT-005 packaging and supported browser matrix, EXT-009 popup polish, EXT-010 license state | None currently; EXT-006 excludes edits |

The desktop and CLI P1 rows are **conditional client gates**: include them only if that client ships in the first supported release. WEB-003 and the multi-vault settings rows are similarly conditional on enabling those item types and views. P2 archive/move functionality already exists experimentally; verify it before enabling it in a supported build. The localhost admin page is P2; operator commands remain the first release control plane.

## Dependency order after P0

1. Finish server restore, migration, clean-host, Docker/LAN, SMTP and security evidence (SRV-002–010). Freeze formats and obtain independent review before any real-secret pilot (SRV-007/011).
2. Close web cross-client, conflict and security verification for the enabled web features (WEB-003/005/008).
3. Select the first supported client set. If desktop or CLI ships, close its sync/device, secret-exposure, packaging and clean-machine rows. Defer drag-to-fill, archive/move and extended item types unless explicitly selected and verified.
4. Complete the extension's permission, origin, frame and lock review. Include it in a supported release only after its own security and browser matrix passes.

No P2 feature blocks P0. Release readiness is evaluated separately by [beta readiness](../release/beta-readiness.md); a P0 pass alone never authorizes real credentials.

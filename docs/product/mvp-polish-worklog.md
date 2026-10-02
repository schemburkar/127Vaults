# MVP polish work log

> Closed historical work log. Current work is tracked in the [component backlogs](README.md). Do not add new tasks here.

Last updated: 2026-09-12

This file is the durable handoff record for the CLI/web polish batch. Update the
relevant entry **before** beginning each item and again after implementation and
verification.

| Item | Status | Notes / acceptance |
|---|---|---|
| Durable work log | Done | Created before other batch work; continue updating it before and after every item. |
| Remember active CLI profile | Done | Successful login writes only the absolute active-profile path to `.127vaults-active`; subsequent status/vault/item/lock/logout commands resolve their default through it. Explicit non-default `--config-dir` still wins. |
| Optional vault selector | Done | Vault/item agent commands infer the sole vault when omitted and fail with an explicit `--vault` requirement for zero/multiple vaults. Names, generated codes, and UUIDs remain accepted. |
| Non-interactive item input | Done (code/tests) | Create/edit accept `--json OBJECT`, `--json -`, `--json @FILE`, repeatable `--field KEY=VALUE`, or explicit `--interactive`. Modes are mutually exclusive and title is validated. Live activation awaits one final agent restart. |
| Typed custom fields in web | Done (code/tests) | Encrypted item bodies now carry typed custom text/password/URL/date/email/number/note fields with safe DOM rendering, edit preservation, copy, and password reveal controls. |
| Website normalization | Done (code/tests) | Plain domains normalize to HTTPS; only HTTP(S), credential-free valid URLs are accepted for primary/custom URL fields. |
| Device revocation in web | Done (code/tests) | Other active devices receive a labelled Revoke action with explicit confirmation and post-action refresh. Current browser has no self-revoke action. |
| General web polish | Done (code/tests) | Custom fields are bounded and uniquely named, dynamic controls are labelled, validation is focused and actionable, and device-management actions have safe confirmation/state feedback. |
| CLI usage documentation | Done | Examples cover remembered profiles, optional vault selection, human references, JSON/KVP/stdin/file/interactive item input, URL normalization, and explicit password output. |
| Final verification and handoff | Done with noted live-credential limitation | Rust workspace tests and clippy pass; JS workspace and web tests pass; browser asset/CSP smoke passes; rebuilt stack is live on schema v3; PostgreSQL contains 4 encrypted items and 2 signed sync operations. The repeatable scripted exercise cannot authenticate the preserved manually-created owner because it intentionally lacks that owner's credentials; a destructive acceptance-volume reset was not performed. Root `pnpm check` reaches all package syntax checks but its final contracts step cannot find `tsc` under the current Windows pnpm layout. |
| CLI custom-field parity and interactive input regression | Done (relogin required) | Normal get renders custom fields while redacting password-typed values; `--password` accepts the built-in name, a custom password label, or its field ID. Create/edit accept `NAME[:TYPE]=VALUE` and web-compatible JSON custom fields. Interactive title/website/username input was verified in a real Windows PTY. The apparent stall was the stale unlock agent holding the old executable open; exact orphan PID 10964 was stopped and the corrected binary rebuilt. Profile `.127vaults-cli-2` must be logged in once to start the new agent. |

## Findings and decisions

- ADR-0019 remains unchanged: local unlock lease is 30 minutes and not
  server-admin configurable in v1.
- Internal database UUIDs remain canonical. CLI-facing `V-…` and `I-…` codes are
  stable, non-name-derived selectors with ambiguity rejection.
- The acceptance image was rebuilt and restarted at `https://127.0.0.1:12780`.
  Asset, HTTPS, no-store, and CSP smoke checks pass. Schema v3 is applied.
- Security regression tests cover enrollment replay, expiry, wrong/unknown
  authorization, device substitution, and signer substitution. A fresh end-to-end
  enrollment run still requires the already-enrolled browser/owner credentials or
  explicit permission to reset the disposable acceptance volume.

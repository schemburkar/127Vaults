# API v1 protocol and CLI naming

Status: **API-001 through API-012 verified**

This document records the canonical `/api/v1` routes. The machine-readable
OpenAPI 3.1 contract is `packages/api-contract/openapi-v1.json`. Compatibility
aliases were removed after browser, acceptance, and CLI consumers migrated.

## Naming rules

- HTTP paths use lowercase kebab-case and the `/api/v1` prefix.
- JSON request and response properties use `camelCase`.
- Database identifiers use `snake_case`.
- Rust types use `PascalCase`; Rust modules and functions use `snake_case`.
- JavaScript classes use `PascalCase`; variables and functions use `camelCase`.
- Public error codes use lowercase `snake_case` only.
- Resource identifiers use the explicit names `authId`, `enrollmentId`,
  `vaultId`, and `itemId`; a bare `id` is used only in its path segment.
- Cryptographic-format, authentication-profile, signed-operation, database, and
  HTTP API versions remain independent.
- A canonical path is matched without a trailing slash, except `/api/v1/auth/`,
  whose trailing slash is part of the approved contract.

## Canonical HTTP routes

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/auth/` | Begin an authentication exchange. |
| `GET` | `/api/v1/ceremony` | Issue the host-only pre-authentication CSRF cookie and matching token used by onboarding. |
| `POST` | `/api/v1/auth/{id}/password` | Complete the password/OPAQUE step. |
| `POST` | `/api/v1/auth/{id}/device-proof` | Complete enrolled-device proof. |
| `DELETE` | `/api/v1/session` | End the current session. |
| `POST` | `/api/v1/onboarding/register` | Register the bootstrap owner. |
| `POST` | `/api/v1/invitations` | Create an invitation as an authenticated owner. |
| `POST` | `/api/v1/onboarding/invitation` | Begin invited-user registration using the invitation token and registration candidate. |
| `POST` | `/api/v1/onboarding/invitation/{id}/email` | Send the verification code for the identified onboarding attempt. |
| `POST` | `/api/v1/onboarding/invitation/{id}/complete` | Verify the email code and complete invited-user registration. |
| `POST` | `/api/v1/device-enrollment` | Start a device enrollment. |
| `POST` | `/api/v1/device-enrollment/{id}/poll` | Poll the identified enrollment using its secret poll token. |
| `POST` | `/api/v1/device-enrollment/inspect` | Resolve and inspect a request by its human code as an authenticated trusted device. |
| `POST` | `/api/v1/device-enrollment/{id}/approval` | Approve the identified request as an authenticated trusted device. |
| `POST` | `/api/v1/device-enrollment/{id}/complete` | Prove possession and complete enrollment from the new device. |
| `GET` | `/api/v1/vaults` | List accessible vaults. |
| `POST` | `/api/v1/vaults` | Create a vault. |
| `GET` | `/api/v1/vaults/{vaultId}/items` | List encrypted item projections. |
| `POST` | `/api/v1/vaults/{vaultId}/items` | Create an encrypted item. |
| `GET` | `/api/v1/vaults/{vaultId}/items/{itemId}` | Fetch the encrypted item body for an explicitly requested catalogue revision. |
| `PUT` | `/api/v1/vaults/{vaultId}/items/{itemId}` | Replace the encrypted item revision. |
| `GET` | `/api/v1/vaults/{vaultId}/operations` | Fetch signed operations after a cursor. |
| `POST` | `/api/v1/vaults/{vaultId}/operations` | Append a signed operation. |
| `GET` | `/api/v1/vaults/{vaultId}/checkpoint` | Fetch the latest signed checkpoint. |
| `POST` | `/api/v1/vaults/{vaultId}/checkpoint` | Create the next signed checkpoint. |
| `GET` | `/api/v1/devices` | List trusted devices. |
| `POST` | `/api/v1/devices/enrollments` | Begin a legacy device enrollment flow. |
| `POST` | `/api/v1/devices/enrollments/approve` | Approve a legacy device enrollment flow. |
| `POST` | `/api/v1/devices/revoke` | Revoke a trusted device. |
| `POST` | `/api/v1/devices/rotate-password` | Rotate password credentials. |
| `POST` | `/api/v1/devices/rotate-account-secret` | Rotate the account secret. |

## Ceremony request boundaries

Multi-step ceremonies use the path identifier as their sole public attempt ID.
Clients must not repeat that identifier in a JSON body. Each endpoint accepts
one exact schema and rejects unknown properties.

Invitation onboarding is separated as follows:

| Route | Exact request properties |
| --- | --- |
| `POST /api/v1/invitations` | `emails`, `expiresInHours` |
| `POST /api/v1/onboarding/invitation` | `token`, `email`, `candidate` |
| `POST /api/v1/onboarding/invitation/{id}/email` | `capability` |
| `POST /api/v1/onboarding/invitation/{id}/complete` | `capability`, `code` |

Device enrollment is separated as follows:

| Route | Exact request properties |
| --- | --- |
| `POST /api/v1/device-enrollment` | `username`, `newDeviceId`, `newDevicePublicKey`, `requestSignature` |
| `POST /api/v1/device-enrollment/{id}/poll` | `pollToken` |
| `POST /api/v1/device-enrollment/inspect` | `code` |
| `POST /api/v1/device-enrollment/{id}/approval` | `approvalSignature` |
| `POST /api/v1/device-enrollment/{id}/complete` | `pollToken`, `possessionSignature` |

`pollToken` and onboarding `capability` are secret, narrowly scoped bearer
values. They belong in the TLS-protected request body, must never be placed in a
URL or log, and remain subject to expiry, attempt limits, and single-use rules.
The `inspect` and `approval` operations require an authenticated trusted-device
session plus same-origin CSRF validation. The other device-enrollment operations
authenticate possession through their bound request signature or poll token.

Item-body retrieval uses
`GET /api/v1/vaults/{vaultId}/items/{itemId}?catalogueRevision={revisionId}`.
`catalogueRevision` is required, must be the only query property, and binds the
body to the exact encrypted catalogue already verified by the client. A missing,
malformed, stale, or inaccessible revision fails without returning another
revision opportunistically.

## HTTP boundary contract

All JSON handlers use the shared server boundary in `apps/server/src/http-boundary.mjs`.
It enforces an exact `application/json` content type, fatal UTF-8 decoding, a
JSON object at the top level, route-specific allowed properties, and a bounded
body before domain processing. Responses always set `Cache-Control: no-store`
and `X-Content-Type-Options: nosniff`.

Successful response bodies remain route-specific objects. Errors use exactly
`{"error":"lowercase_snake_case"}`; public codes are normalized and bounded,
and internal exception messages are never returned. A richer success envelope
is intentionally deferred because wrapping existing cryptographic protocol
objects adds no security property and would create avoidable client churn.

## CLI parity

CLI naming describes user intent; it does not mirror every HTTP path literally.

| CLI command | HTTP capability | Status |
| --- | --- | --- |
| `127vaults login USERNAME` | `POST /api/v1/auth/`, then password and device-proof steps | V1 transport and encrypted replica hydration verified. |
| `127vaults logout` | `DELETE /api/v1/session` | V1 transport migrated. |
| `127vaults device enroll` | Device-enrollment creation and approval | V1 transport migrated. |
| `127vaults vault list` | `GET /api/v1/vaults` | V1 transport and verified local read implemented. |
| `127vaults vault create` | `POST /api/v1/vaults` | Online bootstrap transport implemented; offline vault creation is outside the item synchronization flow. |
| `127vaults vault info` | Vault and item reads | V1 transport and verified local read implemented. |
| `127vaults item list` | `GET /api/v1/vaults/{vaultId}/items` | V1 transport and verified local read implemented. |
| `127vaults item create` | `POST /api/v1/vaults/{vaultId}/items` | V1 transport and durable local queue implemented. |
| `127vaults item edit` | `PUT /api/v1/vaults/{vaultId}/items/{itemId}` | V1 transport and durable local queue implemented. |
| `127vaults item get` | Item-body retrieval | V1 transport and verified local read implemented. |

CLI migration follows the encrypted-local-replica decision recorded in
`cli-offline-replica.md`. Vault creation retains an online bootstrap transport;
item commands use the encrypted replica and signed operation queue. Onboarding
is browser/operator driven. Signed operations and checkpoints are protocol
internals used by higher-level client actions. No public CLI commands are added
for them unless a concrete operator or diagnostic workflow is approved.

## Migration ledger

Allowed statuses are `proposed`, `in_progress`, `implemented`, `verified`, and
`blocked`. Only one item may be `in_progress` at a time.

| ID | Item | Status | Completion evidence |
| --- | --- | --- | --- |
| API-001 | Record canonical routes, naming rules, CLI parity, and known contract gaps. | `verified` | This document; no runtime behavior changed. |
| API-002 | Decide the missing item-body read route and split invitation/enrollment actions into unambiguous request schemas. | `verified` | Canonical routes, exact properties, authorization boundaries, and revision behavior recorded above; no runtime behavior changed. |
| API-003 | Define common request parsing, validation, response envelope, and lowercase error taxonomy. | `verified` | Shared boundary module and tests; auth, onboarding, device-enrollment, device-lifecycle, and private-vault handlers migrated; server tests and syntax checks pass. |
| API-004 | Migrate authentication and session server routes. | `verified` | V1 begin/password/device-proof/session routes implemented with path-bound attempt IDs; password/root round trips collapsed server-side; browser migrated; server and browser tests pass. Legacy aliases remain only for deferred CLI and acceptance-client migration. |
| API-005 | Migrate onboarding server routes. | `verified` | V1 registration preparation/completion, invitation lifecycle, and owner invitation routes implemented; browser owner setup migrated; exact-schema and authorization tests pass. Legacy aliases remain for acceptance-client migration. |
| API-006 | Migrate device-enrollment server routes. | `verified` | Request, poll, inspect, approval, and completion routes implemented with path-bound enrollment UUIDs, exact bodies, trusted-device CSRF, and mismatch tests. |
| API-007 | Migrate vault and item server routes. | `verified` | V1 vault/item reads and mutations mounted; browser migrated; revision-bound body and unexpected-query tests pass. |
| API-008 | Migrate operation and checkpoint server routes. | `verified` | V1 nested sync resources implemented; server and web suites pass. |
| API-009 | Migrate browser calls and remove old-route dependencies. | `verified` | Browser and both live acceptance clients use v1 ceremony, onboarding, authentication, enrollment, vault/item, operation, checkpoint, and invitation routes; focused server/web suites pass. Unused onboarding, registration-start, and session-CSRF aliases removed; CLI-consumed aliases retained. |
| API-010 | Implement offline-first CLI and synchronization transport. | `verified` | Encrypted replicas, durable pending signed operations, conflict rebase and reviewed resolution, checkpoint verification, restart/idempotency tests, and live two-device exercises including revocation, integrity failure, stale create, online and offline edits passed. See `api010-live-evidence.md`. |
| API-011 | Publish the v1 OpenAPI/JSON Schema contract and test implementation conformance. | `verified` | `packages/api-contract/openapi-v1.json` publishes 31 operations, strict request properties, path/query parameters, and error schema; contract inventory and server handler tests pass. |
| API-012 | Remove experimental aliases after all supported clients have migrated. | `verified` | Browser and server use `/api/v1`; experimental sync, vault, enrollment, and device routes and old `/api/auth` routes removed; contract guard and full workspace tests pass. |

### API-010 completion

The live scenarios and known limitations are recorded in pi010-live-evidence.md.

# ADR-0007: Client connectivity and initial item scope

- Status: Proposed
- Date: 2026-09-06

## Connectivity

The server-hosted web client is online-only. Installed desktop, browser extension,
mobile, and CLI clients are offline-first after enrollment. Offline clients keep
an encrypted local database plus the minimum authenticated sync state needed to
detect replay. Desktop, mobile and CLI reconcile queued changes; the extension
is read-only and only pulls verified changes for offline autofill.

The sync design must explicitly handle stale membership, device revocation while
offline, vault-key rotation, maximum offline duration if any, and conflicts. A
server being unavailable must not silently erase or invalidate local ciphertext.

## Initial item scope

Implementation order is:

1. login, username, password, URLs, and custom fields;
2. TOTP seed storage and local code generation;
3. passkeys through a dedicated WebAuthn-compatible design;
4. structured security-question fields;
5. notes.

Security-question answers are treated as generated secrets. The UI should warn
against truthful, discoverable answers and offer generated values.

Attachments are not part of the core item service. They require the optional
attachment capability described in ADR-0008.

# ADR-0003: Device enrollment and opt-in recovery

- Status: Proposed
- Date: 2026-09-06

## Decision direction

Every device has an independent encryption/signing identity and must possess the
user's high-entropy account secret. Normal enrollment also requires approval by
an existing trusted device.

For normal enrollment, the existing trusted device displays a short-lived
one-time code that the new device may enter, or a QR payload that the new device
may scan. The payload binds the intended account, both ephemeral enrollment
sessions, and the new device public identity. It is not a reusable account
secret. The server relays only authenticated enrollment messages and cannot
substitute a device without detection.

The first device generates the account secret and device keys locally during
account bootstrap. It creates a recovery kit; the server receives only public or
verifier material.

For the internal MVP, [the onboarding contract](../security/mvp-onboarding-transport.md)
fixes the 32-byte account-secret printable/QR encoding, transcription checksum,
first browser signing identity, local encrypted storage and failure lifecycle.
The printed kit alone does not implement lost-device recovery. Normal second-device
approval and selected-admin recovery remain later implementation batches.

The internal web MVP registers this first signing identity before signed writes,
using the accepted [browser storage exception](../security/web-client-boundary.md).
Cleared browser storage requires enrollment/recovery when available; the internal
fixture may instead be explicitly reset, never silently approved as a new device.

If every trusted device is lost, recovery is possible only through previously
retained user recovery material or a recovery mechanism the user explicitly
enabled. Without either, encrypted contents are unrecoverable.

Offline user recovery requires the printed account secret, master password, and,
when account MFA is enabled, a TOTP code or recovery code. Selected-admin recovery
is the alternative when its vault policy was enabled beforehand.

## Selected-admin recovery

A user may enable recovery per private vault. The eligibility policy can be any
admin, one specific admin, or any one admin from a user-selected set. One eligible
admin can initiate recovery. An admin does not receive standing access and cannot
browse the vault through an admin interface. A successful ceremony provisions a
replacement user device.

Recovery remains pending for four hours. Before that period completes, no admin
device may receive a usable vault key or envelope that independently enables
decryption. The design must avoid pre-distributing immediately usable recovery
material merely hidden by UI policy.

During the four-hour pending period, the target user from an existing enrolled
device, any admin eligible under that vault's recovery policy, or a server owner
may cancel the request. Cancellation is authenticated, audited, and does not
require vault decryption. The final protocol must still define admin replacement,
policy changes, envelope rotation, server-clock tampering, and what happens when
the user cannot receive a notification.

The server sends the pending-recovery notice to every existing registered device
and to the user's independently configured email address. Device notification is
part of the application protocol; email is an alerting channel and must not carry
vault keys, account secrets, or a bearer link that alone authorizes recovery.
The notice identifies the target account, requesting admin, request time,
scheduled completion time, and available requesting-device/IP context. It does
not reveal vault names, item metadata, or contents.

No interface may claim that an admin who completes recovery is cryptographically
incapable of reading subsequently recovered content. The guarantee is absence of
access before the explicit recovery path, not control of plaintext afterward.

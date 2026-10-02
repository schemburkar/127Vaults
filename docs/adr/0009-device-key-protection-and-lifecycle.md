# ADR-0009: Device key protection and lifecycle

- Status: Proposed
- Date: 2026-09-06

## Platform key protection

Device private keys are generated as non-exportable, hardware-backed keys when a
supported platform can prove that property:

- Windows 11: TPM 2.0 through the Microsoft Platform Crypto Provider;
- Android 13+: Android Keystore, accepting hardware backing only after validating
  attestation and its Trusted Environment or StrongBox security level;
- iOS/macOS: Secure Enclave and device-only Keychain access controls;
- Linux (Ubuntu and Omarchy): TPM 2.0 where present and usable.

“API call succeeded” is not evidence of hardware backing. The client records the
verified protection class in device metadata. Algorithm support differs across
TPMs and secure elements, so the device identity protocol may need hardware-bound
wrapping/signing keys around portable protocol keys rather than assuming every
platform implements one identical primitive.

Linux lacks one uniform consumer application contract for hardware-backed keys.
The exact TPM 2.0 integration, desktop secret-service interaction, sandboxing, and
software fallback policy require a feasibility spike before Linux support is
classified as equivalent to Windows, Android, or Apple hardware protection.

The internal web MVP has an explicit
[software-protected browser identity exception](../security/web-client-boundary.md).
It does not approve native software-backed persistence. Linux without usable TPM
still requires account secret and master password each launch until its separate
storage design is accepted.

## Unlock

The initial unlock mechanism is the master password. Future local quick unlock
may release locally wrapped key material after biometric verification. Product
requirements are face/fingerprint only on Windows, with no PIN fallback, and
Touch ID or Face ID on supported Apple devices. If the platform API cannot prove
biometric-only evaluation, the client must fail closed to master-password unlock
instead of silently accepting a device PIN/passcode.

Biometrics never replace the account secret for enrolling another device and are
not transmitted to the server.

## Revocation and best-effort wipe

Revocation immediately prevents the server from accepting or returning new sync
operations to that device. An offline device can continue using ciphertext and
keys it already possesses; revocation cannot retroactively remove knowledge.

Remote wipe is opt-in and disabled by default. When enabled, an operator may queue
a signed wipe directive. A compliant client that reconnects verifies the directive
and deletes local wrapped vault keys, encrypted caches, queued operations, and
application-controlled temporary data. This is best effort: a modified client,
filesystem snapshot, copied key, or device that never reconnects can defeat it.
UI and documentation must never call it guaranteed remote wipe.

## Optional reconnect reminder

The server may define a configurable interval after which offline-first clients
display reminders to reconnect. The feature is opt-in and disabled by default.
It applies generally rather than revealing that a specific device may have been
revoked. The initial behavior is notification only, not automatic lock or wipe.

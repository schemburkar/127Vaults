# ADR-0014: Per-user credentials and root-key wrapping

- Status: Proposed
- Date: 2026-09-06

## Per-user account secret

Every user has an independent account and a randomly generated high-entropy
account secret. There is no household-wide or server-wide secret that can unlock
multiple users. The server never receives the account secret or master password
in plaintext.

The account secret is represented in a versioned, checksummed, human-grouped text
format and as a QR payload. It may be long and visually “gibberish”; transcription
reliability and checksum strength matter more than memorability. The QR payload is
data, not a bearer URL, and must not send the secret to a web service when scanned.
Printing/exporting requires an explicit sensitive-data ceremony and clear storage
guidance.

The recovery kit may contain the server/instance identifier and user identifier
for usability, but these fields are distinct from secret entropy and authenticated
by the format. Exact encoding and entropy are defined with the cryptographic suite.

## Conceptual hierarchy

```text
master password + per-user account secret
                  |
                  | memory-hard KDF + domain separation
                  v
          account unlock/wrapping key
                  |
                  | authenticated unwrap
                  v
             user root key (random)
                  |
                  +---- wraps private-vault keys
                  +---- participates in shared-vault key envelopes
                  +---- derives separated local purposes
```

Authentication uses a separate domain/protocol from encryption keys. The
[MVP authentication contract](../security/mvp-authentication-protocol.md) defines
the OPAQUE input and identity/epoch binding. The accepted internal-MVP library
profile and probes are in [Batch 5A evidence](../security/opaque-feasibility-evidence.md). ECF1
wrapping keys and OPAQUE outputs are never interchanged.

## Enrollment and offline unlock

A new device must demonstrate possession of both account secret and master
password. Normal enrollment additionally requires approval by a trusted device;
the exceptions are first-device bootstrap and an authorized recovery ceremony.
Knowing both user inputs alone must not silently bypass the device-approval policy.

After enrollment, the account secret is protected by the device's hardware-backed
or approved fallback storage. Unlock uses the master password locally and must work
offline. A wrong password is detected by authenticated failure when opening a
local credential envelope rather than by retaining a fast local password verifier.
Offline guessing cannot be server-rate-limited, so the KDF and local storage threat
model must account for a stolen encrypted device database.

## Master-password change

Changing only the master password creates a new password-derived wrapping key and
rewraps the same random user root key. Vault keys, item keys, item ciphertext, and
attachment ciphertext are not bulk re-encrypted.

Although the cryptographic rewrap can occur locally, the product requires the
server to be online. The initiating client commits one atomic credential-version
transition containing the new authentication verifier/record, new authenticated
wrapped-root envelope, session revocation state, and credential epoch. The server
must never observe either password or the unwrapped root key. Clients do not offer
an offline/pending password-change mode because split credential versions can lock
out devices or create downgrade paths.

Other enrolled devices learn the new credential version on sync and require the
new master password. They remain approved and do not require trusted-device
reapproval after a password-only change because the operation does not rotate the
account secret or device identity.

## Account-secret change

Changing the account secret is an explicit online account-reset ceremony and also
requires choosing a new master password. It generates new unlock/authentication
material, advances the account credential epoch, revokes sessions and old device
authorization, and rewraps the existing user root key without bulk re-encrypting
vault contents.

The initiating trusted device becomes the first enrolled device in the new epoch.
Every other device must be online later and complete normal re-enrollment using the
new account secret, new master password, new device keys where required, and trusted
approval. Old account-secret material and credential messages are rejected after
the transition.

The protocol must specify recovery-admin envelope rotation, shared-vault envelope
updates, offline queued operations from the old epoch, interrupted transitions,
transaction rollback, notification, audit events, and securely replacing printed
recovery kits.

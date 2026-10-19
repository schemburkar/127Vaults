# Web client trust boundary

## Internal MVP browser identity

Accepted 2026-09-08: generate and register the first signing identity during account
setup, before signed writes. Persist only its software-protected encrypted form in
browser storage. Require account secret and master password for each new unlocked
session; retain neither the account secret nor usable identity keys across locks
or sessions. Make no hardware-protection claim. Batches 5B/8A/9 specify wrapping,
session binding, approval and storage lifecycle before their respective use.

Cleared browser storage requires new-device enrollment approved by an existing
trusted device. Do not bypass approval or reset a populated server to enroll a
client. Lost-last-device recovery remains a separate incomplete ceremony. Native
clients use their platform credential protection; that does not make browser
storage hardware-backed.

## Item decryption

The online web client keeps two encrypted layers:

- an encrypted lightweight index/header used to list items after vault unlock;
- separately encrypted item bodies and history loaded/decrypted on explicit use.

The initial header contains only the item title/name and normalized website domain
when available. It contains no username, full URL/path/query, notes, tags, favorite
state, password, TOTP seed/code, passkey private key, security answer, or history
value. The header remains client-encrypted; the server stores only ciphertext and
does not gain title/domain visibility.

Index and body belong to one authenticated item revision under the
[pairing rules](../sync/protocol.md#verified-item-revisions). Their ciphertext
envelopes may have distinct internal revision identifiers; the authenticated
manifest binds the exact pair.

The client decrypts one body on demand, avoids persistent plaintext caches, clears
rendered data on navigation/lock, and performs cryptography in the narrowest
reviewed worker/Wasm boundary practical. This reduces accidental exposure and
memory lifetime but is not a security boundary against arbitrary code executing
in the unlocked origin.

Most importantly, a compromised server that supplies the web application's HTML or
JavaScript can modify that client before unlock. End-to-end encryption protects
stored ciphertext from a passive database/server compromise, but a dynamically
served web client cannot automatically resist an active server that exfiltrates
newly entered credentials. Marketing and the threat model must distinguish passive
stored-data compromise, active server compromise, and installed signed clients.
The initial product accepts this limitation and classifies web access as trusted-
server convenience mode. A persistent banner and onboarding acknowledgement state
that the web vault requires trusting the server. Installed signed clients are the
recommended stronger boundary.

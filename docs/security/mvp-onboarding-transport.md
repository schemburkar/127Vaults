# Internal-MVP onboarding and HTTPS

P2 design, 2026-09-09. Disposable accounts only. This specifies implementation
contracts; it does not certify an implemented or audited protocol. Authentication
and sessions follow P1; private-vault envelopes follow P3.

## Account secret and printed kit

Generate `A` as 32 independent CSPRNG bytes inside Rust. Canonical text is
`127V-A1-` followed by the 58-character unpadded RFC 4648 uppercase Base32 encoding
of `A || checksum`. The checksum is the first four bytes of
`SHA256(ASCII("127Vaults/account-secret/A1") || 00 || A)`. It detects transcription
errors; it supplies no authentication. Never feed the encoded text into a KDF.

The decoder accepts at most 128 ASCII bytes, trims only outer ASCII whitespace,
then requires the exact prefix, alphabet `A-Z2-7`, length, checksum and canonical
re-encoding (including zero unused bits). No case folding, character aliases,
interior whitespace or alternate encodings. Fail without returning partial A.

The QR payload is exactly this same 66-byte ASCII text, with no URI, network
request, account identifier or password. Generate/render it locally using bundled
assets; do not use an external QR service. The printable kit separately labels
the trusted endpoint, installation/account UUIDs and username. It excludes the
master password and warns that possession of the kit is sensitive. Confirm the
user can re-enter the secret before completing registration. Printing/download
requires explicit action; clear the secret/QR view when dismissed or locked.
The kit is not a backup and does not currently implement lost-device recovery.

## First browser identity

One browser profile per account in this MVP. Onboarding creates a random device
UUIDv4 and independent Ed25519 signing seed in Rust. Register its public key with
the account only in the authenticated onboarding transaction. No X25519 key is
needed before recipient enrollment/sharing. Prove signing-key possession using
P1's bound onboarding challenge; a supplied public key alone is insufficient.

Store only an encrypted identity envelope and public descriptors in IndexedDB.
Both account secret and master password are entered for every unlocked session.
After authentication and root unwrap, decrypt the identity and compare its
derived public key with the registered identity before publishing any handle.
The accepted exception is software protection, never hardware attestation.

`IDW1` is a separate experimental format; ECF1 purposes must not be repurposed:

| Field | Exact encoding |
| --- | --- |
| Header H | ASCII `127VIDW1` (8) + tenant UUID (16) + account UUID (16) + device UUID (16) + identity epoch (u64 big-endian, initially 1) + Ed25519 public key (32) + nonce (24) = 120 bytes |
| Key | HKDF-SHA256 Extract(salt=ASCII `127Vaults/IDW1/root`, IKM=root R), then Expand(info=ASCII `127Vaults/IDW1/identity` + `00` + H, length=32) |
| Ciphertext | XChaCha20-Poly1305 of the 32-byte seed; AAD=ASCII `127Vaults/IDW1/envelope` + `00` + H; ciphertext and tag total 48 bytes |
| Whole envelope | Exactly 168 bytes; reject all other sizes, magic, zero epochs, invalid UUID variants/versions, context/public-key mismatch or tag failure |

Use ECF1 UUID network order/validation and its entropy/zeroization rules; device
IDs are v4. Generate a fresh 24-byte nonce internally on every wrapping operation.
The caller supplies expected tenant/account/device/epoch/public key from local
onboarding state, later checked against P1-authenticated account state. Never
adopt a new identity from an envelope or login response. Public-key derivation
and equality checks occur inside Rust; seed/root/key bytes have no JS getters.
This format adds reviewed signing dependencies during 5B, not during ECF1 3C.

Stage the encrypted identity locally before final onboarding submission. Retain
that exact candidate while retrying an ambiguous network outcome; reconcile via
the same onboarding attempt after authentication. Do not silently create another
device. Browser storage failure blocks submission; storage loss after server
commit requires the future enrollment/recovery path or explicit disposable reset.

Lock clears entered secrets, root/device handles, pending results and rendered
plaintext; ciphertext survives. A password-only change preserves R and identity,
while the server credential epoch invalidates old sessions. Identity epoch is
distinct from credential epoch. Secret rotation, device replacement/revocation,
and encrypted identity migration are later protocols, not local record edits.

## Bootstrap, invitation and email proofs

All token bytes use a fallible CSPRNG. Fixed token encodings reject padding,
noncanonical re-encoding and wrong length before lookup. Accept tokens only in
HTTPS request bodies; never URLs, logs, telemetry, referrers or diagnostic exports.

| Proof | Format and lifetime | Consumption |
| --- | --- | --- |
| Initial-owner setup | `127V-B1-` + 43 unpadded base64url characters encoding 32 bytes; 60 minutes | One transaction locks singleton installation state, verifies setup hash/expiry and absence of owners, inserts account+device+auth material, marks setup consumed |
| Invitation | `127V-I1-` + same 32-byte encoding; administrator selects 24 or 48 hours | One successful redemption per exact approved normalized email, bounded by original list size; ordinary user only |
| Onboarding attempt | Random UUIDv4 plus independent 32-byte opaque session capability under P1's pre-auth policy; 10 minutes | Binds token record, email, account/device candidates and authentication transcript; immutable after binding |
| Email verification | Eight uniformly sampled decimal digits, including leading zeros; 10 minutes, at most five failed checks | Bind to attempt, normalized email and generation; consumed atomically with account activation |

Token hashes are HMAC-SHA256 with a dedicated random 32-byte server token key
outside the database. Hash input is purpose ASCII (`bootstrap`, `invite` or
`email`) + `00` + raw token bytes; email additionally includes attempt UUID and
u64 big-endian generation before its eight ASCII digits. Keep key material in a
restricted mounted secret, never an environment dump. Key loss/rotation
invalidates outstanding proofs and requires explicit regeneration.

The host-only setup command creates or replaces the pending setup token only
while no owner exists. It writes a restricted file for explicit operator retrieval;
never routine startup output. Regeneration invalidates the previous token.
Delete the plaintext file after consumption/expiry when the host helper next runs;
the database consumption check remains authoritative if file cleanup fails.

MVP email syntax is ASCII dot-atom local part plus ASCII DNS domain, maximum 254
bytes; no display names, comments, quoted local parts or SMTPUTF8. Trim outer
ASCII space, lowercase the domain, preserve local-part case and reject malformed
labels. Do not apply provider-specific dot/plus transformations. The invitation
and submitted email must match this normalized value exactly; each value is
unique across accounts and within the invitation list. A list contains 1..10
addresses. Broader international email support is deferred.

Email resend requires 60 seconds, permits at most five sends per address per hour,
and invalidates the previous generation. Maintain these counters across attempt
recreation. Exhausted proofs require a new attempt after the rate limit allows it;
invalid invite/email/expired/used cases have the same public failure shape.
Also enforce ten onboarding attempts per source per ten minutes and 100 per
installation per hour; source identity never comes from forwarded headers.
Failed/abandoned attempts consume no invitation seat. Finalization rechecks
invite expiry/revocation, proof expiry, attempt state, account/email uniqueness
and list capacity under one database transaction. Concurrent winners cannot
share a seat or create duplicate accounts. Retry of an already committed attempt
returns its same nonsensitive completion result after capability validation;
it never replays account creation or creates an authenticated session by itself.

Use real operator SMTP with implicit TLS or mandatory verified STARTTLS; fail on
certificate/hostname errors or downgrade. Store credentials as server secrets.
Await submission success before presenting "code sent"; provider acceptance is
not receipt. A failed or uncertain send leaves activation blocked until a valid
code is presented; safe resend replaces the prior code. Render a generic message
containing only the code, expiry and installation label, without invite/secret
material or bearer links. Do not persist plaintext message bodies in queues for
this MVP. A fake mail adapter is permitted only in isolated test configurations.
Bootstrap may record the owner's email as unverified without delaying initial
owner activation; it confers no email-proof privileges. Verify it through the same
proof after SMTP setup. SMTP is required before invited-account activation, not
before first-owner creation. The UI must not present an unverified address as a
verified recovery/alert destination.

## Private HTTPS operational contract

Terminate HTTPS directly in the existing Node server using `node:https`, serving
web/API from one origin. TLS minimum 1.2, maximum 1.3; no HTTP application listener,
automatic cleartext fallback, reverse proxy or forwarded-header trust in the MVP.
The existing HTTP fixture remains a disposable development fixture only.

Provision with a host-only one-shot certificate helper using a pinned reviewed
OpenSSL build in its helper image. Create an installation-specific P-256 root CA
(SHA-256 signature, critical CA=true/pathlen=0 and keyCertSign/cRLSign), validity
five years, and independent P-256 leaf (CA=false, digitalSignature, serverAuth),
validity 90 days. Random positive serials contain 128 random bits; SAN contains
only the active literal loopback/private address, or `localhost` for that exact
local endpoint. Never put arbitrary operator domains in SAN. Backdate notBefore
by five minutes; refuse leaf validity beyond root expiry.

Keep CA private key in a host directory restricted to the provisioning operator,
outside the repository, application mounts, database and ordinary backups.
Mount only leaf key/certificate read-only to the server UID; directory permissions
0700 and private files 0600 in Linux helper storage, equivalent named-user ACLs
on Windows. Never mount the CA signing key into the running application. The
public CA certificate is exportable; an operator transfers it out of band, checks
its SHA-256 fingerprint and manually installs trust on each test device/browser.
Never fetch trust over an untrusted initial connection or bypass certificate errors.

Bind container listener to its assigned backend address; publish its TLS port on
exactly the selected host loopback/private address. Database has no published
port. Validate both host publication and container configuration; a private
container address alone does not establish private host exposure. Host helper
refuses wildcard/global publication and reports changed/missing interface.

Reject unexpected HTTP authority and Origin per ADR-0012. Literal-IP clients may
omit SNI: allow absent SNI only on the single configured IP endpoint, with exact
IP SAN validation at the client and authority checks at the server. When SNI is
present it must match the configured name. Do not require DNS SNI for IP access.

Warn at 30 days before leaf expiry. The operator runs local renewal: generate a
fresh leaf key, sign the unchanged allowed SAN, validate chain/key/SAN/validity,
atomically replace the pair, then restart the TLS process. Failure preserves the
previous valid pair; expiry blocks service rather than enabling HTTP. Root
renewal requires an explicit new trust installation before switching. Address
change requires fresh SAN/allowlist configuration, certificate and origin; do not
silently widen access. Revoked/compromised CA requires removing its trust manually.

Implementation must pin helper image/tool versions and verify Windows/Podman
mount ACLs and browser trust behavior before claiming LAN support. The transport
API supports direct termination ([Node HTTPS](https://nodejs.org/api/https.html));
certificate generation uses reviewed extensions/options
([OpenSSL req](https://docs.openssl.org/3.5/man1/openssl-req/)). These references
support tool capabilities, not a completed deployment verification.

## Required smoke evidence

Check text/QR round-trip and checksum/canonicality rejection; failed storage and
onboarding retry; wrong identity/context/tag; lock invalidation; concurrent
bootstrap/redemption; expired/replaced/exhausted proofs; real SMTP delivery and
invalid TLS; wrong Host/Origin/SNI; private host publication; untrusted/expired
certificates; renewal failure preserving the old pair. Use fictitious data and
record deferred automated coverage. These are implementation acceptance cases.

# ADR-0015: Account onboarding and sessions

- Status: Proposed
- Date: 2026-09-06

## Bootstrap and invitations

The first successfully bootstrapped account becomes server owner. Subsequent
registration is invite-only; no public signup endpoint exists.

Before first-owner creation, the operator retrieves a random single-use setup
secret directly from the host/container. Network reachability alone confers no
setup authority. Validate this capability and consume it atomically with owner
creation; concurrent attempts cannot create multiple initial owners. Never expose
it through a public endpoint, URL or routine logs. The
[onboarding contract](../security/mvp-onboarding-transport.md) specifies encoding,
protected local retrieval, expiry/regeneration and crash-safe consumption for Batch 6.

An admin creates a cryptographically random invite code with an explicit 24- or
48-hour lifetime and shares it out of band, not through 127Vaults. A code can
cover one or an exact list of invited email addresses. Each listed address may
redeem once, and total successful redemptions cannot exceed the list count. A
recipient visits the known server endpoint or opens an installed client, enters
the code, proves control of the claimed listed email with a separate short-lived
SMTP verification code, then locally creates their
username, master password, account secret, and first device.

Invitations create ordinary user accounts only. They cannot embed or confer server
admin or owner status. After successful enrollment, role elevation is a separate,
freshly authenticated, audited, and user-notified action governed by
[server ownership and roles](0017-server-ownership-and-roles.md).

The server stores only a keyed hash of the invite token and atomically records
redemption per normalized email to prevent races. An invitation may constrain
username but cannot grant an elevated server role and contains no vault key. A
bearer cannot claim another list member merely by knowing their address; independent email verification
is required. Codes must carry enough entropy to resist online guessing even with
rate limiting. Exact entropy, encoding, normalization, and invalidation rules
are defined in the onboarding contract.

Account activation requires both invitation and email proofs. Bind email proof to
the intended address and onboarding attempt; consume it once and limit attempts.
The onboarding contract fixes lifetime, retry limits and resend invalidation. SMTP
acceptance is not proof of receipt; see [ADR-0016](0016-outbound-security-notifications.md).

## Identity and password policy

Each account has a server-unique username and an independently verified email.
Email is used for invitation verification, recovery notices, and security alerts, not as input
to vault-key derivation.

New master passwords are preserved as exact UTF-8 input with no Unicode
normalization. They require at least 20 user-perceived grapheme clusters rather
than 20 bytes or code units. Arbitrary uppercase, digit, or symbol composition
rules are not imposed. A strength estimator provides guidance but does not replace
the minimum or compromised-password check. Clients must share test vectors for
grapheme counting and input encoding so the same password works everywhere.

HIBP Pwned Passwords checking is enabled by default and operator-disableable. The
client waits until the complete candidate password is entered, computes SHA-1 only
for this lookup, sends only the first five hexadecimal hash characters through the
selected query path, requests padded results, and compares suffixes locally. The
full password and full hash are never transmitted or logged. SHA-1 is not used for
authentication, KDF, encryption, signatures, or integrity.

Even a padded k-anonymity request leaks a hash prefix, timing, and requester network
metadata. UI and privacy documentation disclose this. Service failure must have a
fail-open policy: if enabled but unavailable, the UI prominently warns that the
password could not be checked against the known-compromised database and allows
the user to continue. An offline downloaded corpus is a future privacy option. No
incremental request is sent for each keystroke.

## Failed authentication and admin unlock

Failed server authentication triggers exponential backoff plus limits scoped by
account, invite, source, and device signals without trusting proxy headers. A
hard threshold of 20 consecutive failures places server authentication into an
admin-unlock-required state. Exponential delays begin after 5 failures: initially
5 seconds, then 15 seconds, 30 seconds, and progressively up to a one-hour cap.
The [authentication contract](../security/mvp-authentication-protocol.md) fixes the
complete delay table, concurrency rules, protocol bounds and enumeration behavior.
A successful fully authenticated login resets the consecutive-failure counter;
partial factors do not.

The counter and next permitted attempt timestamp are account-wide and server-
authoritative. Clients render the countdown locally, but the server enforces it;
a purely client-side delay is bypassable by direct API calls or a modified client.
Separate source/device abuse controls may exist without changing the account-wide
20-failure rule.

Admin unlock requires fresh admin authentication, is rate-limited, audited, and
requires the user and admin to communicate/verify through a channel outside
127Vaults. The locked client displays “Contact a server admin.” No automated unlock
notification is required. Unlock clears only server-side attempt/lock state. It
does not change the master password, account secret, root-key envelope, MFA,
device approval, recovery eligibility, or vault access. A host-local operator
command can clear an existing owner's failure state when no admin can log in;
the authentication contract limits it to those counters and pending attempts.
It neither recovers credentials nor creates a session.

## Sessions and local unlock

The web client locks decrypted state after 30 minutes idle. Its
server authentication session expires 12 hours after creation without refresh.
Use the authentication contract's opaque HttpOnly/Secure session cookie,
same-origin CSRF checks and per-request epoch/device validation. Browser session
restoration can preserve cookies; server authentication never substitutes for
local key unlock. The internal MVP follows the explicit
[browser identity exception](../security/web-client-boundary.md): both credentials
are required each new unlocked session. A surviving server session cannot bypass
local unlock or device approval.

Installed clients remain enrolled until revoked but clear decrypted vault keys
after 30 minutes idle, OS lock, sleep, explicit lock, or process termination. They
retain only hardware-protected account-secret/device material and encrypted local
state needed for later offline unlock.

[ADR-0019](0019-client-locking-and-secret-exposure.md) defines the v1 lock policy
and runtime limits on clearing decrypted material.

## Account MFA

Optional TOTP protects server authentication and does not replace the account
secret, master password, or trusted-device approval. Setup displays the seed/QR,
does not offer to save it into the same 127Vaults account, then presents a lock-
style screen requiring a current code before activation. It generates printable
offline recovery codes.

The ceremony can demonstrate possession of the seed but cannot prove the user
stored it in a separate application or device. Product text must state the rule
without claiming technical enforcement. Hardware security key/passkey MFA is a
later addition.

If both the TOTP authenticator and recovery codes are lost, an eligible selected
admin may reset account MFA only through the same four-hour recovery ceremony,
existing-device/email notifications, cancellation window, and audit trail. MFA
reset alone does not recover vault keys or bypass device enrollment.

## Web-client active-server limitation

Decrypting item bodies one at a time limits plaintext lifetime but does not protect
an online web client from an actively malicious server that serves modified
JavaScript. Such a server could steal the master password or keys as they are used.
This is a fundamental distinction from an installed, signed client.

Before claiming malicious-server resistance for web access, the project must choose
and review a trusted-client delivery mechanism, such as a separately distributed
signed/static client with verifiable integrity. HTTPS, CSP, SRI, service workers,
and minimal decryption improve defense but do not by themselves make JavaScript
served by a compromised origin trustworthy.

For the initial product, the server-hosted web client is explicitly a trusted-server
convenience mode. Onboarding and persistent security/settings UI state that the
user must trust this server to deliver honest web-client code. Installed signed
clients are recommended where active malicious-server resistance matters. The
banner cannot be permanently hidden merely because the user dismissed a notice.

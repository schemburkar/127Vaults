# ADR-0016: Outbound security notifications

- Status: Proposed
- Date: 2026-09-06

## Scope

127Vaults does not deliver account invitations. Admins share invite codes and the
known private server endpoint through an independent channel.

Email is used for recovery/security alerts and a separate short-lived verification
code proving the invited address. Invite codes themselves remain external. The
internal MVP requires configured SMTP for invited-account activation; both invite
and email proofs are required. Hosted verification delivery is deferred pending
its own credential-handling/privacy design; current relay scope stays generic alerts.

For recovery/security alerts, a self-hosted operator chooses
one of:

1. operator-configured generic SMTP;
2. an optional paid 127Vaults outbound relay sending from an official 127Vaults
   domain;
3. email disabled, where permitted by the recovery policy.

The chosen mode does not change device notifications, which remain the primary
application-protocol alert channel.

Provisional relay pricing is $5/year per Personal server and $25/year per
Commercial self-hosted deployment; it is included with 127Vaults Cloud. BYO SMTP
has no 127Vaults relay fee. Prices are planning assumptions until operating costs
are measured and commercial terms are published.

## Hosted relay privacy boundary

The self-hosted server sends the relay only the recipient address, generic alert
template identifier, opaque server/request identifier, locale, expiry, and replay-
prevention/authentication material. It never sends an invite code, master password,
account secret, MFA seed/code, recovery code, vault/item name, decrypted content,
key envelope, private server URL, or a bearer link that can authorize an action.

The relay necessarily observes recipient address, requesting IP/account, timing,
template/event type, delivery status, and abuse signals. Setup discloses this
metadata before opt-in. The relay has a published retention policy, suppresses
message-body logging, encrypts queued delivery data, and provides deletion/export
behavior suitable for applicable privacy law.

Relay requests use per-installation scoped credentials, rotation, rate limits,
idempotency, and signed responses. Compromise of relay credentials can at worst
send bounded generic messages; it cannot authorize recovery or access a vault.

## SMTP and failure behavior

SMTP credentials are server secrets stored outside the vault database and excluded
from backups unless separately protected. Certificate verification is mandatory;
plaintext SMTP and silent TLS downgrade are unsupported.

Recovery/security alert delivery is best effort. Provider acceptance, bounce, or lack of a bounce
cannot prove human receipt. Failure is visible in the recovery/security event but
does not hide or cancel existing-device notifications and does not stop the four-
hour recovery from completing. Email is never treated as proof that the user
approved an action.

Invitation email verification is different: activation waits for the user to
present the separate valid code. Delivery failure cannot bypass proof. The
[MVP onboarding contract](../security/mvp-onboarding-transport.md#bootstrap-invitation-and-email-proofs)
defines an eight-digit, ten-minute proof, five failed checks, resend invalidation,
atomic activation and real SMTP requirements for Batch 6;
verification codes are excluded from logs and diagnostic exports.

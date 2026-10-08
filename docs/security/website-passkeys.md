# Website passkeys in 127Vaults

This feature is a synced software WebAuthn authenticator, separate from account
login and root-key unlock. Private ES256/P-256 PKCS#8 keys live in the existing
encrypted item body, in a reserved password field. Credential identity, RP ID,
user handle and origin live in a reserved metadata field inside that same body.
The server stores and syncs existing signed ciphertext operations; it never
implements a website's relying-party verification or receives plaintext keys.

Each ceremony requires explicit approval in the extension and fresh master
password verification by the selected vault source. Mere approval is user
presence, not user verification. Only after verification may the authenticator
set UP and UV. Credentials are backup eligible (BE); BS stays clear because a local save is not
proof of a completed backup. They use a
permanent zero signature counter, and return none attestation with zero AAGUID.
Registration must persist the encrypted item before the website gets success.
Failure or an ambiguous save must never return registration success.

The initial provider supports HTTPS top-level pages, exact-host RP IDs, ES256,
none attestation, discoverable credentials and explicit allow/exclude lists.
Parent-domain RP IDs, frames, WebAuthn extensions other than registration credProps, conditional mediation and
platform-only requests use the native browser path. These limitations must be
visible; this is experimental support, not a universal authenticator.

The extension needs permission only for sites where the user enables its
provider. The page-world shim sends serialized request options to an isolated
bridge; the service worker derives the real HTTPS origin from the browser's
sender, checks the top frame and current navigation, and queues a bounded,
expiring request for approval. No page supplies a vault selector or operation.
Responses contain WebAuthn public response bytes, never a private key.

The trusted extension may transiently hold a decrypted key for WebCrypto signing,
as it already transiently holds selected passwords. Private keys must never enter
page messages, local/session extension storage, logs, URLs, clipboard, arbitrary
custom-field editors, or generic item summaries. JS strings and CryptoKey lifetime
cannot guarantee complete zeroization. Lock, navigation, abort and timeout cancel
pending ceremonies. Native source requests are restricted to metadata listing,
fresh password verification, selected key retrieval and create-only passkey save.
This is a narrow registration exception to read-only password filling, not an
item editing API. A key-holder-only signer is a future hardening opportunity.

Independent security review and live Chrome/Edge relying-party acceptance remain
release gates. Test that signatures verify, RP/origin/challenge substitution
fails, exclusions prevent duplicate registration, persistence precedes success,
and cancellation / lock never releases a response. Deleting a vault item does not
revoke the website credential; users must remove it from that website as well.

# Key hierarchy (experimental design)

No stable algorithm profile or wire format is approved. Batch 3B defines a
[disposable experimental content format](experimental-crypto-format.md) for review:
password/account-secret protection wraps an independent random user root key,
which wraps independent random private-vault keys. Domain-separated per-context
subkeys encrypt item bodies and indexes. It fixes byte encodings, bounds and
failure rules for that fixture only; it does not implement this hierarchy.

An item index and body use distinct ECF1 envelopes and encryption revision IDs.
A separately authenticated logical revision/manifest must bind the exact pair to
the expected tenant, vault, item, key epoch and logical revision from verified
state. Envelope headers cannot supply their own trusted expected context. Reject
incomplete or mismatched pairs and retain the last verified version. Manifest
encoding and authentication are specified by the [P3 contract](../architecture/private-vault-contract.md); ECF1 does not provide signatures,
checkpoints or rollback protection. See [verified item revisions](../sync/protocol.md#verified-item-revisions).

The Rust core now has a native/WASM-compilable secret ownership feasibility
component, not a key hierarchy. Its supported crypto format list is empty.
See [scope, interfaces and verification](../architecture/implementation-interfaces.md).

Keep password-derived material, account secrets, authentication credentials,
user/vault keys, device encryption/signing identities and optional recovery keys
separate. Recipient envelopes protect keys; they do not grant server roles access.

The experimental specification covers local KDF inputs, wrapping, associated
data, nonce generation and disposal rules. Product approval still requires
deterministic vectors, composition/library review, authentication binding,
credential-update atomicity, key rotation, device provisioning, shared/recovery
envelopes, secure local storage, memory-exposure validation and emergency export.

We will use established libraries and constructions. “Inspired by 1Password” is
a product/security goal, not permission to copy or improvise its protocol.

P3 defines the internal-MVP directory/catalogue trust chain and private-item API.
Its additional MAC records require Batch 7 composition/dependency review and
vectors. P1/P2 login binds root-envelope revision/digest and credential epoch;
registration publishes an empty authenticated directory with the root envelope.
Browser identity uses [P2 IDW1](mvp-onboarding-transport.md#first-browser-identity),
never a repurposed ECF1 purpose. Signed sync and fresh-session rollback detection
remain excluded from this disposable persistence slice.

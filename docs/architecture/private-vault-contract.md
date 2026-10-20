# Private-vault persistence contract (P3)

> Historical P3 slice specification. Its one-profile/no-sync scope and numerical limits describe that initial slice, not the current feature set. Current routes are in [API v1](api-v1-contract.md); current client behavior is in the [product index](../product/README.md).

Experimental internal MVP: one online browser profile and one private vault per
account; sample login create/list/read/update. No delete, history, sharing,
offline queue or signed multi-device operations. This is a specification, not
evidence of implementation or stable-format approval.

## Hierarchy and trusted context

Independent 32-byte account secret A, root R and vault key V originate in Rust.
ECF1 purposes 01/02 protect R under password+A and V under R; purposes 04/03
protect index/body under V. Initial epochs are 1. Keep scoped key handles inside
Rust. Browser identity uses [P2 IDW1](../security/mvp-onboarding-transport.md#first-browser-identity), never an ECF1 purpose.

P1/P2 registration atomically publishes root envelope and empty D below. Login
binds expected server identity, tenant/account, credential epoch, root-envelope
revision and SHA256 digest. Construct expected ECF1 context from that descriptor,
not the unverified header. Unwrap R; verify D; verify its vault-envelope digest
and expected context; unwrap V; verify M; use M for exact item contexts/digests.
Match selected route IDs at every step. Fresh login is not an independent
freshness anchor against a malicious server. Password change retains R and
atomically rewraps through the auth ceremony. Rotation/recovery are excluded here.

## Exact records

Unsigned fixed-width big-endian integers; raw RFC-order UUIDs; SHA256 digests;
no optional/trailing bytes. IDs follow ECF1 rules; new IDs/revisions UUIDv4.
Sort entries by unsigned ID bytes; reject duplicates. Base is nil only for first
creation. Revisions identify bytes, not time. Unknown magic fails closed.

`D` = ASCII `PVD1` || tenant(16) || account(16) || revision(16) || base(16) ||
count(u16) || entries || tag(32).
Entry(72) = vault(16) || epoch(u64) || vaultEnvelopeRevision(16) ||
SHA256(complete ECF1 vault envelope)(32). Count 0..10; max 822 bytes.
MVP authorization permits one vault/account; five is the parser ceiling.

`M` = ASCII `PVM1` || tenant(16) || vault(16) || epoch(u64) || revision(16) ||
base(16) || count(u16) || entries || tag(32).
Entry(136) = item(16) || logicalRevision(16) || indexRevision(16) ||
bodyRevision(16) || indexLength(u32) || bodyLength(u32) || indexSHA256(32) ||
bodySHA256(32). Lengths/hashes cover complete ECF1 envelopes. Count 0..100;
max 13,710 bytes. Logical/index/body revisions are distinct. Each edit replaces
both envelopes with fresh revisions; unchanged entries remain byte-identical.

```text
dPRK = HKDF-Extract-SHA256(ASCII("127Vaults/PVD1/root"), R)
dK = HKDF-Expand-SHA256(dPRK,
  ASCII("127Vaults/PVD1/mac") || 00 || tenant || account, 32)
mPRK = HKDF-Extract-SHA256(ASCII("127Vaults/PVM1/vault"), V)
mK = HKDF-Expand-SHA256(mPRK,
  ASCII("127Vaults/PVM1/mac") || 00 || tenant || vault || epoch_u64, 32)
tag = HMAC-SHA256(dK or mK, all preceding record bytes)
```

Full tags; established constant-time verification; MAC keys stay in Rust.
These separate records leave ECF1 unchanged. Reuse the reviewed graph in
[3C0](../security/ecf1-dependency-selection.md): hmac =0.13.0 (defaults off,
zeroize on), hkdf =0.13.0 (defaults off), sha2 =0.11.0 (defaults off, zeroize on).
Batch 7 reviews this additional composition/API use and native/WASM fixed-byte
vectors; prior dependency evidence does not validate the new composition.
Records expose IDs/lengths/hashes,
never titles/domains. MACs establish key possession, not device signatures.

## Verification and rollback limits

List fetches M and every index in one snapshot. Verify M, exact entry completeness,
index digest/context/tag and decrypted schema. ECF1 C uses verified tenant/vault/
item/epoch, zero account, schema 1 and the relevant M encryption revision.
Open fetches body for the retained exact M; verify digest/context/tag and compare
body-derived index to decrypted index before displaying the body. Lazy listing
verifies a body commitment, not its availability or AEAD; full pair verification
occurs on open. Never call an unopened body verified.

Retain verified state on mismatch, show failure and freeze writes. Retry fetch;
do not accept suspect bytes. Retain head revision+digest in memory; replace only
with the client's successful expected-base proposal. A 409 requires explicit
refresh/review before retry, no automatic overwrite/merge. Lock clears keys,
plaintext, descriptors and pending requests; invalidate late results.
No durable checkpoint: fresh-session rollback, older valid directories, omission,
isolated forks and malicious server JS remain possible. Signed history and
durable checkpoint comparison are later sync work.

## HTTPS API

Prefix `/api/experimental/v1`; apply P1 session/CSRF rules. Derive actor from
session. Private owner alone has access; server admin/owner adds none. Missing
and unauthorized IDs return identical 404. Reject unknown/duplicate JSON fields.
UUIDs: canonical lowercase hyphenated strings. Bytes: canonical unpadded
base64url; reject padding, invalid alphabet and nonzero unused bits.

| Method/path | Request or successful response |
| --- | --- |
| GET `/private-vaults` | Response `{directory,vaultEnvelopes:[{vaultId,envelope}]}` |
| POST `/private-vaults` | Request `{requestId,baseDirectoryRevision,directory,vaultEnvelope,catalogue}`; sole vault + empty M |
| GET `/private-vaults/{vault}/items` | Response `{catalogue,indices:[{itemId,envelope}]}`; transactional snapshot |
| GET `/private-vaults/{vault}/items/{item}?catalogueRevision={revision}` | Response `{catalogueRevision,itemId,envelope}`; 409 if head changed |
| POST `/private-vaults/{vault}/items` | Request `{requestId,baseCatalogueRevision,catalogue,index,body}`; add exactly one entry |
| PUT `/private-vaults/{vault}/items/{item}` | Same request; replace exactly this entry |

GET has no body. Initial empty D has nonnil revision; vault creation uses it as
base. Rust selects object IDs before encryption. Writes return `{requestId,
directoryRevision,catalogueRevision}` matching retained client proposal;
directory changes only on vault creation.

One PostgreSQL transaction locks account/vault, rechecks session/device/credential
epoch and ownership, compares base, validates public contexts/hashes/lengths,
enforces quota and publishes complete envelopes, D/M, receipt and audit event.
DB uniqueness enforces one private vault/account and scoped request IDs. Reject
entry removal, changes to untouched entries, wrong record base and epoch changes.
Each publication has a new nonnil D/M revision; reject reuse of the current
revision. Vault creation adds exactly one D entry owned by the session account,
with epoch 1, a matching purpose-02 envelope and an empty initial M (nil base).
Item writes preserve D and all other items; the changed entry ID matches the
route (update) or is absent from the old M (create). No arbitrary catalogue
replacement endpoint exists.
No partial publication or independently mutable index. Server cannot verify
MAC/AEAD; 2xx proves storage acceptance only. Replaced bytes may be discarded
atomically; this slice offers no password history. Reads use one DB snapshot.

Request ID is UUIDv4 scoped by tenant/account. After authorization, check receipt
before base comparison. Fingerprint = SHA256(u32 method byte length || UTF-8
method || u32 canonical-path byte length || UTF-8 canonical path || exact request
body bytes). Retransmit byte-identically. Same ID/fingerprint returns original
success; different bytes produce 409 `REQUEST_ID_REUSED`. Concurrent duplicates
commit/audit once. Keep receipts for disposable database lifetime; failures roll
back receipts. Uncertain timeout retries same ID/bytes; after lock/relogin fetch
current state before any new edit.

## Bounds, audit and acceptance

ECF1 envelope maxima: root/vault 205 bytes, index 65,709, body 1,048,749.
JSON body max 2 MiB before parsing; decoded bytes max 1,125,000. List response
max 5 MiB. No compressed/chunked item codec. Engineering limits: 100 items/vault,
10 vaults/account, 10 accounts, 2 devices/account. One write/vault, max 10 writes
and 20 reads concurrently/server; overflow 429 + Retry-After, no unbounded queue.
HTTP deadline 30 seconds; DB lock/statement deadlines 5 seconds; failures roll
back. Cap receipts at 10,000 successful mutations/installation, then refuse
without deleting data; distinct from 100-operation smoke workload/ECF1 counter.

Fixed errors: 400 `INVALID_REQUEST`, 401 `AUTH_REQUIRED`, 404 `NOT_FOUND`,
409 `BASE_CHANGED` / `REQUEST_ID_REUSED` / `QUOTA_EXCEEDED` /
`EXPERIMENTAL_LIMIT`, 413 `TOO_LARGE`, 429 `BUSY`, 503 `UNAVAILABLE`.
Unknown formats return 400; no downgrade/provider text. P1 auth throttles apply.

Successful mutation audit: server timestamp, tenant/account/device, vault/item
IDs, request ID, action, old/new logical revision and outcome. No titles, domains,
field values, ciphertext or tags. Existing 90-day default/365-day maximum audit
retention applies; creation/edit timestamps persist. Redact proxy/app bodies.
Audit is server metadata, not signed authorship; retries add no duplicate event.

Batch 7 adds a private-persistence port, not signed `SyncTransport.submit` calls.
Revise draft `VaultService` for preselected IDs/full transaction and CryptoCore
unwrap for explicit expected contexts. Carry manifest proof beside EncryptedItem;
type casts never verify bytes. Preserve client LoginItem/LoginIndex validation;
encode JSON UTF-8, enforce ECF1 byte limits, reject duplicate/unknown keys after
decryption. Digests commit actual envelope bytes, not reserialized JSON.

Smoke: two-account isolation; create/reload/open/update; races and duplicate
requests; transaction failure; forged MAC; missing/substituted/truncated pair;
wrong context; limits; lock during request; database plaintext absence; audit/log
redaction. Independent vectors/adversarial automation remain deferred until run.
Q-006 is specified; implementation evidence remains outstanding.

Schema 9 expands the directory limit to 822 bytes and catalogue limit to 13,710
bytes. Existing PVD1/PVM1 records and ciphertext remain unchanged. Upgrade the
server and all clients together before exceeding the previous 5-vault/50-item
bounds: older clients reject larger records. Back up and rehearse restoration
before applying the transactional schema 8-to-9 migration.

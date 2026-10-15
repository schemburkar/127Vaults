# Actual Windows CLI signed-license recovery

Selected Windows CLI-b from `cd67ab2c224df758f173fd393590c4586386f8b8`
passed actual license read-only/revoked notices and durable queue recovery on
the separate selected-server installation `9865ecb1-2e46-475f-bc91-5f7b8e71b7cf`.
LOCAL-02 remains open for applicable Linux GUI/client and later-expiry locked
cases. Intended-host and physical acceptance are a separate user follow-up.

The package binary was compared byte-for-byte with its verified release archive.
The CLI pinned the fixture CA/installation and generated its own random device
key. The registered fixture owner authenticated, inspected the exact proposed
UUID/public-key fingerprint and signed approval through the production protocol.
The CLI completed possession proof and OS-keyring storage. This was genuine
CLI enrollment; the approver was the crypto-protocol fixture, not browser UI.
New device: `aea45a26-9f72-4079-9e74-5f0ada6da9d1`.

The supported operator installed short-lived active sequence 4. After natural
expiry, a real CLI edit received HTTP 423 and persisted one encrypted request.
`license status` reported read-only and renewal/write-refusal guidance. Repeated
sync left the exact request intact and redacted review showed the intended title
and error. A fresh agent process repeated those checks without changing the
request. Sequence 5 renewal allowed normal sync to replay it, after which a normal
CLI edit restored the synthetic baseline and the queue emptied.

Supported signed revocation of sequence 5 repeated the same queue/restart/retry
checks with revoked guidance. Sequence 6 renewal replayed that exact request;
baseline restoration and empty queue checks passed. Missing synthetic username
and website fields were normalized to empty strings through supported CLI edits;
the original synthetic password stayed unchanged and masked by default.

A separate process authenticated as the original registered owner device,
decrypted the final server catalogue/index/body and verified restored fields and
the secret. It found one catalogue item and exactly one accepted history entry
for each original native queued operation. This did not rely on the CLI cache.

Private evidence in `C:/Projects/127Vaults-license-isolated-20261015-a`:
`native-license-evidence.json`, seven phase records, enrollment request/approval,
two exact encrypted queue snapshots, baseline metadata and independent peer read.
Native profile: `native-cli-windows-b`. The fictitious issuer key remains outside
Git. Current license is sequence 6, active until the next day; future tests must
check current time/state and use increasing sequences, never replay old mutators.

All owned source/restore containers are stopped with volumes retained. The
original 12892 installation remains healthy. CLI agents are stopped and the
profile queue is empty. Syntax/diff and expanded release audit checks pass. These
fixture-only changes require no product rebuild. No remote push.

Next: genuinely enroll a Linux CLI device on this installation, then use that
device/keyring for the selected Linux GUI license notice/queue cases. Never copy
a Windows device profile into Linux or fabricate its keyring enrollment. Preserve
the original paired operational acceptance fixture and all revoked-device drafts.

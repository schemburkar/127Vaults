# Selected extension: actual web permission boundary — October 15

Selected Chromium extension-a (`07fdca5`) passes a real installed-extension
missing-host-permission check against selected server/web/admin-a (`cbb1be0`,
image `4bfc4bf6`). This is negative permission-boundary evidence; affirmative
web-source fill/lock/reconnect remains unaccepted. Full internal release is open.

The release manifest and complete file set/hash were verified. The archive SHA256
is `622cbc13e83d3e6361c82074f07fe6f3a4196a54a7d8a59e548d8392ad08484d`.
All unpacked files were compared byte-for-byte to their pristine ZIP entries;
the exact selected extension was loaded in Linux Chrome for Testing 151.0.7922.34
as an actual MV3 worker/action popup. No extension or Chrome API was mocked.

The retained genuinely enrolled member browser unlocked the actual packaged web
app through OPAQUE/strict-CA HTTPS and production assets/WASM/IndexedDB. The test
wrote only the public `vaultOrigin` extension setting to model a saved vault
address whose optional host grant is absent. This is explicitly not a test of
successful Connect/grant UI. The actual permission APIs confirmed no origin grant.
A synthetic `https://web-move.invalid/login` document was the target; no external
website was contacted. Its real toolbar popup was triggered on that active tab,
attached through CDP and explicitly selected Web tab as source.

The extension displayed `Connect your vault web address.`, kept results hidden,
exposed zero item buttons and no password in popup text, and left target username
and password empty with zero submits. The actual source app remained unlocked
during this refusal. Before/after permission sets were equal with no host origins.
The source app was then explicitly locked and the browser/container closed.
No vault mutations occurred. No native-host registration or personal browser was
changed. A public saved origin remains in this isolated fixture extension storage;
that setting does not grant access.

Candidate evidence:
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a`:
`extension-selected-package.json`, `extension-web-permission-refusal.json` and
`extension-web-refusal-combined-evidence.json`. Unpacked selected files are retained
in `extension-selected/127vaults-extension`; successful existing member profile is
preserved. Runner verifies selected files before reuse, not a source-tree substitute.

```powershell
node scripts/internal-member-acceptance-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a --extension
```

New/changed helper syntax and combined verification pass. The chain rechecks
member/native/web/P1 records, exact bundle/wiring, stopped owned project, absent
browser container/member processes, original 12892 health and unchanged revoked-D
encrypted pending copy/removal journal. Nothing was pushed; no runtime artifact
or Windows launch-policy setting changed.

A concise permission question is pending for affirmative web-source tests inside
this isolated Linux browser: Chromium grants `https://127.0.0.1/*` by host, not by
port, though the app must select the exact 12898 origin. The earlier unresolved
website-permission boundary was not treated as authorization. No grant API or
Connect action requesting that permission was invoked. Pending answer does not
block other safe automated release work. Broader physical/Windows/idle/passkey,
client/interruption/concurrency and intended-host gates remain open.

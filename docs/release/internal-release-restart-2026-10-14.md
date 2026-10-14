# Internal release restart checkpoint — October 14, 2026

Subsequent work and newer selected packages are recorded in
[October 14 progress](internal-release-progress-2026-10-14.md). It supersedes the
candidate labels below: server `internal-20261014-e`, Desktop
`internal-20261014-b`, CLI `internal-20261014-c`, all source `ee83e2d`; extension
is unchanged. Native lost-reply recovery now passes in both OS writer directions.
Internal release is still unaccepted. The 12892 fixture still uses bundle-d.

Saved at the user's request before further work. **Internal release remains not
accepted.** The goal card is paused; no goal completion or remote push occurred.
All implementation and evidence tracking through `caee58d` are committed on local
`main`. This checkpoint is the next commit. Preserve existing fixtures and user
data when resuming.

## Resumed work after this checkpoint

Four additional real-server scenarios passed on the selected Windows/Linux CLI
packages: archive/restore propagation with archived-write refusal, durable
overlapping-edit review followed by explicit server-copy recovery, explicit
local-copy resubmission, and automatic merge of a local username change with a
peer title change. All final queues/conflict lists were empty. The fixture vault
was restored, original data retained, and owned server/database restarted healthy.
Repeatable lifecycle/native phases are now in the packaged CLI helper. Details
and exact limits are appended to the expanded evidence matrix.

Evidence is retained under `C:\Projects\127Vaults-sync-web-20261014-a`:
`lifecycle-native-server-copy.json`, `lifecycle-native-local-copy.json` and current
`lifecycle-native.json` (automatic merge). Runner `linux-lifecycle.sh` explicitly
uses WSL distribution `Ubuntu-24.04` and the isolated keyring. Commits through
`65fbe25` cover the first three scenarios; the next commit records automatic merge.

Windows GUI manual-launch status and isolated web-extension origin permission
were surfaced again during resumed work and remain unanswered at this update.
They remain pending acceptance gates. New-vault creation hit the retained fixture's
five-vault cap before mutation; the generic CLI `vault encryption failed` capacity
message remains an issue. No limit or user data was changed to make tests pass.

## Completed since the previous checkpoint

- Fixed real PostgreSQL PWA conflicts: HTTP 409 `base_changed` is normalized at
  the API boundary. Packaged field comparison/merge and server-copy recovery
  passed while preserving queued edits on failed refresh.
- Fixed consecutive native creation signing against a stale accepted head.
  New Windows and Linux CLI packages each created all seven enabled item types
  consecutively without intermediate sync or leftover conflicts.
- Exposed card and other custom/related fields in web item details. Packaged
  web read/edit round trips preserved ordinary fields, secrets and type markers,
  with verification by both OS CLI packages.
- Guarded extension source switching against late asynchronous results and
  guarded web startup controls until initialization completes.
- Verified trusted real-server web/native online and offline round trips,
  accepted-but-lost PWA response recovery with a newer native edit preserved,
  and Linux packaged Desktop consecutive saves plus offline process restart and
  replay against a Windows packaged CLI peer.
- Verified the installed extension's full form/source matrix using the actual
  Linux Desktop GUI as its source, including source handoff, lock, reconnect,
  frame/origin refusal and no-submit behavior.

Checks included 68 native library tests, the separately gated live Rust device
management test, Rustfmt/strict Clippy, web checks/tests, 28 extension tests, and
`node scripts/mvp-acceptance.mjs dev --check`. These passed; the startup preflight
does not establish that the user's GUI was launched. Separate isolated PWA
regressions cover broader queue/storage cases; those do not substitute for every
real TLS/PostgreSQL packaged acceptance gate.

Authoritative details and scope limits:

- [Expanded evidence matrix](internal-sync-release-plan-2026-10-13.md)
- [Readiness decision](internal-release-readiness-2026-10-13.md)
- [Checksummed artifact inventory](internal-release-artifacts-2026-10-13.json)

## Selected candidates

Root: `C:\Projects\127Vaults-releases`. All six complete artifact sets and SHA256
checks were verified. Use these candidates, not retained reproduction packages.

| Product | Label/platform | Source commit |
| --- | --- | --- |
| Server/web/admin | `internal-20261014-d/linux-amd64` | `103da5b24e9e5a5a00366ad731a8efb7b9ca4b12` |
| Desktop | `internal-20261014-a/windows`, `linux` | `103da5b24e9e5a5a00366ad731a8efb7b9ca4b12` |
| CLI | `internal-20261014-b/windows`, `linux` | `b63e6e539653fa25b50a1e73cbb6b2cfef5691c3` |
| Chromium extension | `internal-20261014-a/chromium` | `07fdca56a281f786b18c639347d86c631bc64585` |

Server image: `localhost/127vaults-server:release-4497166804580e4a`.
These are unsigned private test candidates, not evidence of real-secret readiness.

## Remaining work, in restart order

Follow-up after the resumed scenarios: CLI verified comparison and explicit field
selection are implemented and pass on both new immutable CLI packages, with
opposite-OS reads. The [sync parity tracker](sync-parity-2026-10-14.md) records the
new capabilities, package selection, reverse-direction lifecycle/settings review
and exact evidence paths. New CLI extraction roots end in `sync-cli-20261014-b`;
profiles remain the existing guarded `20261013-a` fixtures. All six selected
artifact sets were reverified. Item queues and settings decisions are tracked
separately. The broader remaining gates below still apply.

1. Latest Windows packaged Desktop GUI: online creation/editing, offline queued
   edits plus process restart/replay, field comparison/server copy and extension
   handoff. Manual launch is pending; see the boundary below.
2. Actual web-tab extension source: unlocked/locked and multiple matching tabs,
   permission, reconnect, navigation and lock. Narrow fixture-origin permission
   is pending. Also rerun Windows native extension acceptance during an active
   Windows session; today's attempt correctly reported idle and is not a pass.
3. Broader latest-package cross-client queue/conflict/deletion/create-ID collision,
   native lost-response and non-overlapping edit cases; vault/settings/default
   view lifecycle, ownership, revocation and expiry across client surfaces.
4. Real TLS PWA installation, cache upgrade and offline process restart. Existing
   installed-mode emulation is not physical installation evidence. Old service
   workers can keep old code until tabs close; update UX remains a gate.
5. Physical OS lock, intended-host and clean physical Windows/Linux acceptance;
   optional passkey permission/real ceremonies remain external gates. Measure
   observed native source/keyring list latency (about 9–14 seconds) separately.

Do not repeat green checks without a change or unresolved concern. Record each
scenario's actual package, source, platform and limits before accepting the release.

## Pending human steps and execution boundaries

The user previously approved isolated Windows package testing, but automatic
approval review still rejected agent GUI launch as **"blocked by policy"**, with
no further reason. Do not bypass the rejection through another launcher or UI.
The pending manual instruction is to run
`C:\Projects\127Vaults-sync-desktop-20261013-a\start-isolated-desktop.ps1`, leave
the app at its unlock screen and reply "Opened". The starter now selects `app-i`,
copied fictitious `profile-h`, `webview-i`, inspector port 12915 and
`app-i-pid.txt`. No manual-launch reply/PID has been received.

Permission to grant the isolated test extension access to the fictitious vault
origin `https://127.0.0.1:12892` is also unanswered. Do not grant it, broaden
website permissions, or interpret elapsed time as approval. Yesterday's "Active
now" reply does not establish an active Windows session today. Keep idle and
origin protections enabled.

## Retained runtime and evidence

At save time the owned `vaults-test-a0540f7d9c99` server/database containers were
healthy and running on **https://127.0.0.1:12892**. No build or acceptance process
remains running, and no user GUI was launched by the agent. Recheck runtime state
on restart. The user's normal development installation was not reset or replaced.

Current operator directory:
`C:\Projects\127Vaults-sync-web-20261014-a\server-bundle-d`.
Start/stop from there with `node server.mjs install start` or `stop`, supplying
`--compose-provider C:\Projects\127Vaults\.tools\compose\Scripts\podman-compose.exe`.
Use the retained `server-fixture-d.json` mapping for port 12892; the operator's
printed 12780 URL is not the current fixture port. Do not start older bundles.
Installation UUID: `14725fef-f5b4-4cb8-afe0-77aa3d80b268`.
Identity: `C:\Projects\127Vaults-internal-recovery-20261012-d\restored-identity`.
Never initialize a replacement identity for an existing server.

| Evidence/workspace | Contents |
| --- | --- |
| `C:\Projects\127Vaults-sync-web-20261014-a` | Persistent enrolled fictitious browser, per-item web/native evidence, current `web-native.json` lost-response pass, seven-type results and recovered original native IDs |
| `C:\Projects\127Vaults-sync-cli-20261014-a` | Current Windows packaged CLI; it uses the retained fictitious `sync-cli-20261013-a\profile` |
| `/home/vaults-dev/vaults-sync-cli-20261014-a` | Current Linux packaged CLI; retained fictitious profile under the corresponding `20261013-a` workspace |
| `C:\Projects\127Vaults-sync-desktop-linux-20261014-a` | `online.json`, `peer.json`, `offline.json`, `queue-identity.json`, `peer-advance.json`, `replay.json`, actual GUI connector evidence and saved runners |
| `/home/vaults-dev/vaults-sync-desktop-20261014-a` | Current Linux GUI package/profile; inspector 12917, owned launch/cleanup scripts |
| `/home/vaults-dev/vaults-sync-extension-20261013-a/browser-test-gui-20261014-c/evidence.json` | Passing current installed extension matrix with actual Linux GUI source |
| `C:\Projects\127Vaults-sync-extension-20261013-a\browser-test-20261014-a\popup-failure.json` | Today's Windows idle failure; not acceptance evidence |
| `C:\Projects\127Vaults-sync-server-20261014-b\evidence.json` | Packaged server/admin audited writes, authorization, encrypted backup and guarded restore subset |
| `C:\Projects\127Vaults-pwa-wire-conflict-20261014-a\evidence.json` | Separate broad isolated browser/PWA regression evidence |

Repeatable checked-in helpers: `internal-web-native-sync.mjs` (online, offline,
merge/server-copy conflict and lost-response modes), `internal-web-typed-sync.mjs`,
`internal-packaged-cli-sync.mjs`, `internal-desktop-ui-smoke.mjs`,
`internal-extension-form-smoke.mjs` and `extension-popup-driver.mjs`, under
`scripts/`. They require explicit owned fixture paths and identity guards.
Use saved external runners for exact environment/keyring setup; do not print
profile credentials or commit fixture keys/binaries. Browser image:
`localhost/127vaults-sync-web:20261014-a`; browser profiles/CA trust are isolated.
Linux keyring environment is retained at
`/home/vaults-dev/vaults-internal-keyring-20261012-a`.

Current web/native gate vault is `66031b92-58ad-4114-b967-dcbf0541be24`, with about
39 items. Avoid unbounded new fixtures in that vault. Preserve earlier failed
queues and intermediate failure evidence; successful recovery is recorded without
discarding user edits. Restore native host registration/profile pointers after
owned tests, stop only owned processes, and leave unrelated data untouched.

## Local commit trail

Latest to earlier: `caee58d`, `07fdca5`, `92873dc`, `103da5b`, `eecdf4b`,
`1c244ad`, `de3f854`, `17990e9`, `0d5300f`. The detailed matrix explains each
change and its validation. Resume from this checkpoint and the selected artifact
inventory rather than restarting the investigation or claiming full acceptance.

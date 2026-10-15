# Selected native readers on server-a — October 15

Selected server/web/admin `internal-20261015-a` (source `cbb1be0`, image
`4bfc4bf6`) now has additional packaged native-reader acceptance. This closes
these reader/sync combinations only; full internal release remains unaccepted.

Both selected CLI-a binaries (`600f206`) were compared byte-for-byte with their
binaries inside the verified Windows/Linux release archives before execution.
Windows device B and Linux device A used actual packaged agents, online device
requests and sync against the newly selected server. The helper refuses profiles
with pending item writes or an existing removal journal before sync. Both devices
read the exact reserved Linux-created move copy, verified title/website/username,
retired-source state, the nine-item owner catalogue, default password redaction
and explicit built-in/custom secret access. Conflict review remains empty. These
are distinct devices and neither is the original Linux writer C.

Selected Linux Desktop-c (`4e1e146`) then ran as an actual native application with
a copied genuinely enrolled fixture profile and private keyring bus. Its extracted
executable hash matched the binary from the selected Debian package. Through real
DOM/React controls and native backend, it unlocked Online, verified device identity,
read the retained peer title/ordinary/custom fields, masked both secrets, revealed
and remasked each, waited for zero pending changes and locked. This was a fresh
process launch reading retained data, not a new Desktop move/writer case. Original
GUI profile and executable were retained; the new profile is
`/home/vaults-dev/vaults-lifecycle-isolated-20261015-a/gui-server-a-20261015-a`.

The Desktop preflight initially used a `./usr/bin/…` tar entry while the archive
actually contains `usr/bin/…`. It stopped before launching. The archive was
inspected, the exact entry selected, and the retained profile copy was verified
identical before retry; no deletion/reset or installation/native registration was
used. Portal/PipeWire warnings did not prevent the native GUI assertions from
passing. No Windows GUI launch or policy setting was attempted or changed.

Evidence is in the selected candidate fixture directory:
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a`.
Records: `candidate-cli-windows.json`, `candidate-cli-linux.json`,
`candidate-desktop-linux.json`, and `candidate-native-combined-evidence.json`.
Retained runners: `run-cli-windows.mjs`, `run-cli-linux.mjs`, and
`run-desktop-linux.mjs`; Linux scripts use a private D-Bus/keyring session.
The Desktop runner asserts the selected server image before launch. The verifier
also checks selected native release manifests/hashes and the underlying candidate
P1/move data and cleanup evidence.

```powershell
node tests/internal/audit/candidate-native-verify.mjs C:/Projects/127Vaults-lifecycle-isolated-20261015-a/candidate-server-20261015-a
```

New helper syntax and combined verification pass. Owned server/database are
stopped, exact extracted bundle/wiring remain unchanged, original 12892 stays
healthy, revoked D's pending request/journal remain exact, and member lifecycle
records are preserved. No product runtime or selected artifact changed and no
push occurred. Remaining work includes broader new-server writer/interruption and
client pairings, actual member CLI enrollment/reads, latest Windows GUI/physical
installation/keyring/OS-lock, installed PWA/extension permissions and intended-host
operations. Current selected server fixture is the candidate directory; the old
root fixture still names historical server-e and must not be used to start old
software for new acceptance.

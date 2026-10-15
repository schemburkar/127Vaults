# Isolated lifecycle acceptance — October 15, 2026

The original 12892 installation already contains five retained vaults. Move tests
there would retire an existing fixture. A new installation was provisioned from
the selected server-e release into
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a` instead.

- Installation: `98027ac4-9882-42d5-812a-a18c972c299f`.
- Project: `vaults-test-632a4442dfd2`; separate PostgreSQL volume and private CA.
- Client test origin: loopback `https://127.0.0.1:12898` only. Fault proxy upstream
  temporarily uses host 12899 while the server retains internal port/origin 12898.
- Server source: `ee83e2d1363fccdd4d031e6cf3cd928b1ef7d361`, selected server-e
  image verified by ID. Only fixture Compose listener/PORT and manifest checksum
  differ from the extracted release. No product image modification.
- Packaged Windows CLI: `internal-20261015-a`, source `600f206`; two distinct
  devices of the new fictitious `owner_127` account use actual Windows keyring keys.

The source `api010_acceptance` helper gained an explicit enrollment-only mode for
an absolute new external client root. It establishes CA/server trust, adopts only
the deterministic fictitious first-owner device key, enrolls a distinct device
and unlocks both, then stops before historical mutation scenarios. Existing keys
with a different value are refused. Provisioning is source-helper evidence;
subsequent lifecycle operations use the immutable packaged CLI.

Initial fixture setup errors were preserved and corrected: the pristine archive
uses port 12780, not the earlier copied fixture's 12894; fresh installation ID
comes from the started database's operator identify command, not a restored
identity's installation-id file. The first card input incorrectly used a text
marker instead of metadata; the corrected fixture resumes only its checked
partial baseline. A subsequent expected URL lacked the CLI's normalized trailing
slash after the move had succeeded. Verification resumed that completed move
without resubmitting it. These failed setup/assertion attempts are not product
failure or passing evidence, and their logs/data are retained. No reset or deletion
was used to repair a test.

## Required new cases

| Case | Required evidence |
| --- | --- |
| Normal move | Login/card copies exactly once, peer field/secret verification, collection de-duplication and default-view retargeting; retired source keeps originals, refuses edits and archive-only restore |
| Accepted copy reply lost | Durable journal/reserved destination ID and exact encrypted pending request survive agent restart; receipt replay makes one copy and finalizes once |
| Accepted finalization reply lost | Durable final request survives restart after server retirement; exact receipt replay clears the journal with no duplicate copies |
| Cross-OS reader | Newly enrolled Linux device reads all four final copies and retirement/default state using the selected packaged Linux CLI |

Final outcomes and evidence index follow after verification. Broader Desktop/web,
reverse-writer, ownership, physical and original release gates remain separate.

## Windows outcomes verified

The normal move and both interruption cases pass against selected server-e with
the immutable Windows CLI-a. Distinct Windows device B verifies exact field and
secret preservation and one copy per title. Copy and finalization each have two
upstream HTTP 200 responses: the first accepted reply is dropped, then a new agent
replays the same request ID and SHA256 body. The copy operation ID also matches.
Reserved destination IDs and the complete removal journals survive restart;
final requests clear only after receipt verification. The final destination has
four copies, with no duplicates; all three source vaults are retired.

Evidence: `move-evidence.json`, `proxy-evidence.json` and `evidence.json` under the
fixture workspace. Original/retry runners and failed logs remain there. The proxy
was removed, the new project stopped, and its exact environment restored. The
original 12892 installation was neither stopped nor modified. A Linux reader run
is recorded below when complete.

Source helper checks: Rust example Clippy and format check pass; both JavaScript
helpers pass syntax checking and actual fixture execution. Enrollment-only mode
rejects a relative root before creating a profile or touching the keyring. No
product runtime code changed; selected artifacts remain unchanged.

## Cross-OS reader and completion boundary

The newly enrolled Linux device passed `all-peer` using selected Linux CLI-a:
all four destination IDs, titles, ordinary fields, card markers, masked secrets,
explicit login/card secrets, all three retired sources, synchronized default and
empty local queue were verified. Linux enrollment used the source helper on a
private D-Bus session with the retained fictitious keyring; the read operations
used the immutable packaged Linux binary. Both OS package manifests/file hashes
and the exact replay evidence pass the combined verifier.

Combined evidence is
`C:/Projects/127Vaults-lifecycle-isolated-20261015-a/combined-evidence.json`.
`linux-peer-evidence.json`, `verify-all.mjs`, `run-linux.mjs` and `linux-peer.sh`
record the cross-OS path. Source enrollment and native keyrings are explicitly
separated from physical installation or GUI acceptance. The isolated project is
stopped with its five vaults/data retained; the original 12892 server/database
remain running. No remote push, public deployment or existing-profile reset.

This closes the packaged Windows-writer normal move and copy/finalization reply
loss subset with Windows/Linux independent readers. It does not close Desktop/web
move UI, Linux writer, changed-source/destination, abort/keep-copies, authorization
loss, ownership or physical gates. Remaining active synthetic data may support
further interruption scenarios; use a new isolated project if extra vaults are
needed, since this lab now also contains five directory entries. Preserve failed
runs and original journals rather than resetting either installation.

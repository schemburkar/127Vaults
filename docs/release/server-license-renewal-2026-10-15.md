# Selected server signed-license refusal and renewal

Selected server-a image `4bfc4bf6344f20efcb574501aca5c6f212d3ffdc752892867b504b74a8939a27`
from `cbb1be02e68e484c82334cd4389dcc4b09f64cf2` passed a fresh loopback
HTTPS/PostgreSQL signed-license rehearsal. LOCAL-02 remains partially open:
native/GUI notices, native durable queues, later-expiry locked mode, and physical
host cases are not established by this server/crypto-protocol fixture.

Fresh workspace `C:/Projects/127Vaults-license-isolated-20261015-a`, origin
`https://127.0.0.1:12900`, installation
`9865ecb1-2e46-475f-bc91-5f7b8e71b7cf`, source project
`vaults-test-8df6db11fb2d`. No previous installation was relicensed or reset.
The fresh setup initially passed the existing seven operational checks; licensed
mutations subsequently changed this source's synthetic item, so its initial
backup/restore pair is historical rather than a current matching-data proof.
The separate retained operational acceptance pair was not changed.

Using a fictitious issuer key kept outside Git, supported `install license`
commands installed active sequences 1, 2 and 3. Sequence 1 expired naturally
after 45 seconds; no host clock, license verifier or budget was overridden.

- In read-only grace, a real encrypted, signed update received HTTP 423 with
  `license_read_only`. Authenticated login and reads worked, and the complete
  encrypted catalogue/index/body remained unchanged.
- Sequence 2 renewal accepted the byte-identical retained request. Repetition
  returned the same receipt and produced exactly one matching history operation.
  Authenticated decryption verified the intended title and preserved secret.
- Supported `install revoke` applied a signed revocation for sequence 2. A second
  real encrypted update received HTTP 423 with `license_revoked`; reads and
  original ciphertext remained available and unchanged.
- Sequence 3 renewal cleared the old revocation and accepted the exact second
  request. Repetition again returned the same receipt, with one history entry
  and the intended authenticated plaintext.
- Reinstalling sequence 2 was refused after sequence 3, preserving `.env` exactly.

All six prepare/check/replay phases passed. Private encrypted request files and
issuer material remain outside Git. `license-server-evidence.json` binds phase
records, installation, selected image/revision, rollback refusal and preserved
request file hashes. Source and restore containers are stopped with volumes
retained; the original 12892 installation remains healthy. Syntax and diff checks
passed; no product code or new build was needed for these fixture-only checks.

Next: use genuine enrollment and the selected native/GUI packages to verify
client-owned queue retention and visible license states/renewal. The server
fixture's protocol request files are explicitly not native replica queues.

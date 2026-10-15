# Selected server-a fresh installation and backup/restore — October 15

Selected server/web/admin `internal-20261015-a` (`cbb1be0`, image `4bfc4bf6`) now
passes its own fresh operational rehearsal. Earlier server-e operational evidence
is no longer the only live backup/restore evidence. Full internal release remains
unaccepted; this is the existing Windows Podman host, not intended/unrelated-host
or Docker/physical acceptance.

The immutable archive and release file set were verified before a fresh external
workspace was created. Its SHA256 is
`db56bf303df88353ba4940acf6189cb49a1a6a153a725dd6f7b203064ef1a012`.
Seven actual packaged-operator checks passed:

1. Fresh installation identity and packaged admin-operator setup.
2. Strict trusted-CA HTTPS startup, exact Host and wrong-SNI refusal.
3. Bootstrap owner, encrypted item create/read/update, same-request parallel
   idempotency, stale-base race and malformed encrypted-index transaction rollback.
4. Admin sign-in, unauthenticated refusal, invitation create/idempotent replay,
   divergent-body refusal, revoke, secret-free audit and sign-out/session invalidation.
5. Current-schema encrypted database and identity backup plus database rehearsal.
6. Combined restore into a separate new empty project, with duplicate restore to
   that now-populated project refused; restored operator configuration matches.
7. Original owner login and item access through the restored identity/database.

A stronger follow-up starts each retained source and restored project separately,
asserts the exact selected running image, authenticates the same owner through
production OPAQUE/device proof, unwraps the actual root/vault and decrypts both
item index and body. The known winning race title/password pair is checked.
The complete catalogue/index/body encrypted digest and installation/counts are
identical between source and restored projects. This improves the previous
restored-owner helper, which only checked that an encrypted item index existed.
No database content was seeded or reset for the follow-up.

Fixture: `C:/Projects/127Vaults-server-a-ops-20261015-a`, loopback 12899.
Installation `74ab932d-ff5d-4191-a0bd-c84ee3bef8f8` is distinct from retained labs.
Source project `vaults-test-839fae33ec27`; restore `vaults-test-7df535db7946`.
Both projects are stopped and their separate named data volumes are retained,
as are private backup/key/identity files outside Git. No original volume was
restored over, removed or reset. The new helper refuses an existing workspace for
fresh rehearsal. Read-only verification mode starts only these two retained
projects sequentially and stops them afterward; it does not repeat restore.

```powershell
node scripts/internal-selected-server-ops.mjs C:/Projects/127Vaults-server-a-ops-20261015-a --verify-existing
```

Records: `evidence.json` (seven checks, installation/projects/archive hash) and
`selected-operational-evidence.json` (selected provenance, paired decrypted reads,
matching encrypted digest and cleanup). A first wrapper attempt incorrectly
expected stopped containers to remain; packaged stop actually removes containers
and keeps volumes. The verifier now checks no live project and exact retained
volumes, and checks actual image while running. A follow-up helper invocation
also needed the packaged operator's bundle working directory; corrected before
successful verification. Neither was a runtime product defect. Failed diagnostics
remain private; no duplicate restore was used to fix observation.

New/changed helper syntax and live verification pass. The member/native/web/P1/
extension-negative verification chain confirms original 12892 healthy, retained
candidate stopped, exact revoked-D pending copy/journal unchanged and no member
processes/browser containers left. Only original 12892 services remain running.
No release artifact, Windows GUI policy, browser permission or native registration
changed; nothing pushed. Physical trust/installation, intended-host operations,
external SMTP, affirmative extension web access and remaining client/interruption
matrix gates remain open.

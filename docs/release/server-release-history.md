# Server release history

Reconstructed from immutable local release manifests, private catalogue records,
retained deployment/acceptance evidence and source commits. These are restricted
experimental distributions, not stable public releases. Build-only candidates
are excluded. Existing historical license policies were not active license grants.

Git history was rewritten for licensing; published artifact provenance still
contains the original source IDs shown below. The mapped IDs identify the same
code in current local main. Do not relabel or rebuild old bytes under old hashes.

## Server 0.0.0 — 2026-10-16

Restricted trial baseline: encrypted vault operations, private-item deletion, synchronization and offline queues, license handling and packaged web/admin/operator tools. This is the selected friend-trial baseline, not every earlier internal build.

- Channel: restricted private trial; unsigned artifacts.
- Artifact: `127vaults-server-0.0.0-linux-amd64.tar` (835,085,312 bytes).
- SHA-256: `2a648b33b72d591dc887216095081210e50a374a1c98b2030357a1a2dcbc9e30`.
- Original source: `69e078a77b843f0f34bb39411d68a43d15aecf29`.
- Current-history equivalent: `87d742bd606e7209294685e3e20bbfc7c2669de5`.
- Release label: `friend-trial-20261016-a`.
- Install/upgrade: use the package guide and guarded upgrader; preserve identity, CA, license, database and recovery material.
- Limits: clean-host Docker, full reboot/trust/physical-lock matrix and Mac acceptance are not established by these records.

Source changes reviewed:

- 69e078a feat: approve unpaid ten-day trials with private website delivery
- f720f13 release: record locally verified item deletion acceptance
- 8d95a85 feat: delete individual encrypted items across clients and server
- a574a62 fix: refresh license warnings during unlocked desktop and web sessions
- dd041da test: organize internal acceptance workflows into categorized suites
- 70080c4 test: rehearse selected server backup restore and verify decrypted data
- cbb1be0 fix: preserve web move sources when destination copies change
- ee83e2d Close local pending-review, vault-capacity and PWA update gaps

## Server 0.0.1 — 2026-10-17

Added guarded server upgrades with encrypted database/identity backups and restore rehearsal, native Compose-provider support, and shared product branding on web/admin screens. Earlier 0.0.1 packages were replaced during the same trial iteration; version alone does not identify the bytes.

- Channel: restricted private trial; unsigned artifacts.
- Artifact: `127vaults-server-0.0.1-linux-amd64.tar` (1,227,173,888 bytes).
- SHA-256: `a37676ed8f24d0490e0a0a1a079414e850c1474b4d4de2788603baf7f44b7a64`.
- Original source: `2d77f17c917fd9187119670702dac6380a351ca7`.
- Current-history equivalent: `4a3c010d967c1c7f6a8ff34c09366bfe2af3a618`.
- Release label: `sunrise-upgrade-20261017-2d77f17`.
- Install/upgrade: use the package guide and guarded upgrader; preserve identity, CA, license, database and recovery material.
- Limits: clean-host Docker, full reboot/trust/physical-lock matrix and Mac acceptance are not established by these records.

Source changes reviewed:

- 2d77f17 fix: finish shared branding on server admin and legacy screens
- cae2d7e feat: apply public logo and wordmark across graphical apps
- 50b4c4f fix: prepare guarded private-server upgrades and consumer setup
- 4d60cc4 fix: support native Compose providers through Podman
- b914eb7 feat: keep private Cloudflare deployment inputs inside the project
- 2357aef feat: add Cloudflare access backend and automated private trial deployment
- 4307145 ui: remove development banner and login implementation copy
- 85e19ce feat: run private trial site locally with simulated email
- 0262aa9 feat: send approved trial invitations through Cloudflare email
- abc11e4 release: verify private trial packages and real license installation

## Server 0.0.2 — 2026-10-17

Wait for final PostgreSQL startup during restore rehearsal instead of mistaking the temporary initialization server for a ready database. Preserves the existing installation, identity, database and license through the guarded upgrade.

- Channel: restricted private trial; unsigned artifacts.
- Artifact: `127vaults-server-0.0.2-linux-amd64.tar` (1,227,174,400 bytes).
- SHA-256: `4cb69de10442025e6823c43ad41c320e66e3503e93d249dadac30b640c2baa05`.
- Original source: `28974fe98b1b24e5b6983f8762fab6214f970ee7`.
- Current-history equivalent: `ebadd101ad5033f0799cb1df521a9b3ef65617db`.
- Release label: `sunrise-restore-20261017-28974fe`.
- Install/upgrade: use the package guide and guarded upgrader; preserve identity, CA, license, database and recovery material.
- Limits: clean-host Docker, full reboot/trust/physical-lock matrix and Mac acceptance are not established by these records.

Source changes reviewed:

- 28974fe fix: wait for final PostgreSQL startup before restore rehearsal

## Server 0.0.3 — 2026-10-18

Stop timed-out Compose-provider processes and wait for final database readiness during setup. This server was selected for the combined private reconnect catalogue together with desktop 0.0.3, CLI 0.0.2 and extension 0.1.1; those client fixes are separate package versions.

- Channel: restricted private trial; unsigned artifacts.
- Artifact: `127vaults-server-0.0.3-linux-amd64.tar` (1,227,176,960 bytes).
- SHA-256: `c031e736601a6e3c6d464cd310d70402df1c5c8a5057634e347dee0a6f30fa23`.
- Original source: `a64a53bc8cb09f93a2bc7303261fcf7721531884`.
- Current-history equivalent: `4d90c3f09307cec370516d1672a8e08b7671e5e5`.
- Release label: `private-setup-20261018-a64a53b`.
- Install/upgrade: use the package guide and guarded upgrader; preserve identity, CA, license, database and recovery material.
- Limits: clean-host Docker, full reboot/trust/physical-lock matrix and Mac acceptance are not established by these records.

Source changes reviewed:

- a64a53b fix: stop timed-out Compose providers and wait for final database startup

## Version 0.0.1 artifact variants

The retained catalogues identify both `cae2d7e` and `2d77f17` source variants.
The final selected variant is documented above; a later lock/client catalogue
reused it rather than creating a new server version. Keep release labels, full
source IDs and checksums when reconstructing GitHub releases. Never infer a
separate published release solely from an internal build-index entry.

## Server 0.0.4 — 2026-10-18

Reduced the server runtime to production dependencies and compressed the offline
download. PostgreSQL and the TLS helper remain bundled for offline installation.
Fixed identical simultaneous vault saves occasionally returning a false conflict
by serializing receipt lookup within the database transaction.

- Private experimental channel; unsigned package. Live catalogue: `slim-20261018-4d6191d`.
- Source: `4d6191dac45325ed9b05bdf0d6bd9b67e3503407` (already in sanitized history).
- Artifact: `127vaults-server-0.0.4-linux-amd64.tar.gz` (240,072,681 bytes).
- SHA-256: `e95a2ce19d5143d920bcf01beb395eb80bdff6f280a0d2f9a6909a037b5639f1`.
- Verified: fresh install, simultaneous-save replay, signed commercial test license,
  0.0.3 upgrade preserving identity/CA/license/configuration/encrypted items, and
  encrypted backup plus restore into a new project.
- Limits: existing Windows/Podman host with an explicit fixture-port override;
  clean-host Docker, actual Sunrise installation, full reboot/trust/OS-lock and
  Mac/signing acceptance are separate. Use the guarded upgrader; keep backups.


Local annotated tags `server-v0.0.0` through `server-v0.0.4` point to the sanitized
source equivalents above. GitHub release bodies and a draft index are retained
locally for manual creation after repository setup; no GitHub release or push
was performed.

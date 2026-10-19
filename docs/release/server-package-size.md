# Server package size

Version 0.0.4 uses a separate production-dependency stage; the final image no
longer contains the workspace build/development dependency store. The offline
archive is gzip-compressed and ordinary tar extraction detects it automatically.
The PostgreSQL and TLS-helper images are unchanged, retaining offline setup and
the tested runtime ABI. No existing installation or volume is removed to save space.

| Measurement | Previous 0.0.3 | 0.0.4 |
|---|---:|---:|
| Website archive, bytes | 1,227,176,960 | 240,072,681 |
| Server image, bytes | 763,890,358 | 240,051,291 |
| Installed Node dependencies | about 527 MiB | about 1 MiB |

The website download is 80.4% smaller. The extracted bundle's
file bytes total 703,311,237; compressed download size is not installed disk usage.
PostgreSQL remains the largest separate offline dependency. Keep capacity for
images, both upgrade bundles and encrypted backups until acceptance is complete.

Validation used the exact immutable release package from source
`4d6191dac45325ed9b05bdf0d6bd9b67e3503407`: fresh installation, a signed fixture license,
simultaneous identical-save replay, a guarded 0.0.3 upgrade, preserved CA and
configuration, encrypted-item read, encrypted backups, restore rehearsal and
restore into a separate project. Fixture port overrides preserve existing
listeners. Raw results and build-only candidates remain outside Git.

The server/web/installer release gates passed; six server tests requiring
separately configured services were skipped and are not claimed as passed.
Existing-host Podman testing does not establish clean-host Docker, physical
second-host, complete OS-lock/trust/reboot or Mac acceptance.

The combined private website catalogue is live. All 37 R2 objects were verified
against their SHA-256 values, endpoint checks passed, unauthenticated artifact
access was refused, and the actual authenticated website archive matched the
tested package bytes and passed normal extraction plus inner-manifest checks.

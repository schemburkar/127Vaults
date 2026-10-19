# Installer license refresh — 2026-10-19

The private Cloudflare download catalogue now selects the following packages:

| Component | Previous | Current |
| --- | --- | --- |
| Server, web and admin | 0.0.4 | 0.0.5 |
| Windows/Linux desktop | 0.0.3 | 0.0.4 |
| Windows/Linux CLI | 0.0.2 | 0.0.3 |
| Chromium extension | 0.1.1 | 0.1.2 |

All packages were built from committed source
`1c4a7bf82592fc4cb271251a7c0c9286ca6e285e`. This refresh replaces the old
license-policy file with the adopted `LICENSE.md` and `COMMERCIAL-LICENSE.md`,
including embedded copies in installers and archives. Setup guides reflect the
current documentation. Vault formats, database schema and application runtime
behavior are unchanged from the previously selected component revisions.
Existing installations do not need an immediate upgrade for functionality; new
downloads should use these packages to receive the adopted agreements.

Validation covered:

- Release-tool tests; Windows/Linux native checks, client tests and packaged
  CLI/native-host startup; extension checks; server, web and installer tests.
  The server build passed 261 tests; six service-dependent tests were skipped.
- Adopted license text inside the Windows installer, Linux Debian/AppImage,
  both CLI archives, extension ZIP and server archive.
- Isolated Windows Podman installation and a guarded 0.0.4-to-0.0.5 upgrade using
  native Compose. Encrypted items, signed license, CA, identity and configuration
  survived; encrypted backups, restore into a separate project and owner login
  after restoration passed. The initial legacy Python Compose attempt was
  rejected by the prerequisite check before upgrade mutation.
- All 43 private R2 files verified against SHA-256; one combined catalogue
  deployment; protected download access and the full authenticated server
  download verified through the live website. Public website copy was updated
  in the same deployment.

The packages remain unsigned. This refresh does not establish additional
platform acceptance or an independent security review. Existing releases,
installation volumes and deployment rollback records were preserved. Private
build logs, detailed acceptance evidence and deployment receipts remain outside
Git.

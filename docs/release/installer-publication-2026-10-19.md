# Installer publication — 2026-10-19

Installer 0.1.0 is published in the private production catalogue on
`https://127vaults.com/trial?review=1` and existing eligible invitation download
pages. The trial website and Worker were deployed together after both native
installer packages passed their release gates. Installer source revision:
`bc10373b8be866715020b9ad9433e498139a3c3c`.

| Platform | Package | SHA-256 |
| --- | --- | --- |
| Windows x64 | `127vaults-installer-0.1.0-windows-x64.zip` | `f84f1a51cfb82e85a1bb4388f7391d1c92c06038b8b2056905473f8e339775cd` |
| Linux x64 | `127vaults-installer-0.1.0-linux-x64.tar.gz` | `7693858e9c023b592789116fe6926ecd2110426109057cf28fc74a4e25e3e5ba` |

The combined catalogue retains the 43 previously published server/client and
supporting artifacts unchanged, and adds 14 installer artifacts, including the
two packages and their guides, agreements and verification metadata. Server
0.0.5, Desktop 0.0.4, CLI 0.0.3 and extension 0.1.2 remain selected. The
catalogue's server source revision remains
`1c4a7bf82592fc4cb271251a7c0c9286ca6e285e`; installer artifacts carry their own
source revision. Existing immutable R2 objects were reused and verified.

Validation completed before publication:

- All 110 application, website, deployment, release and server-upgrade tests.
- Seven Rust installer tests on each native Windows/Linux build, linting with
  warnings denied, optimized builds, executable startup/version checks, archive
  checksums and embedded agreement verification.
- Publication payload audit, encrypted production D1 export, deployment dry run,
  private bucket checks, and full SHA-256 verification of R2 catalogue artifacts.

Production verification completed after the combined deployment:

- Review and invitation HTML/modules expose the installer flow.
- Authenticated review and an existing eligible invitation list both installers.
- Both packages downloaded through both authenticated routes match their hashes;
  unauthenticated review downloads are refused.
- The packaged Windows and Linux executables successfully resolve all five
  component choices against the live service using an existing invitation in
  `--plan` mode. The existing installation binding is unchanged.
- Installer protocol 1 reports minimum installer version 0.1.0. An authenticated
  request declaring version 0.0.9 receives HTTP 426.
- Normal production readiness checks and full server-download verification pass.

These publication checks exercise delivery and authenticated planning. They do
not claim a fresh server installation on every supported operating system.
Browser approval, CA trust, owner enrollment and any operating-system elevation
or engine-startup steps remain as documented in [the installer guide](installer.md).

The production Worker version is `23983e72-2c37-44ae-857f-f24fce8dba05`.
Detailed build, backup and delivery receipts remain outside Git in the private
release cache under `installer-live-20261019-bc10373`.

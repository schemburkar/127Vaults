# Windows native passkeys — experimental local build

Implemented and compiled, but live Windows-picker registration, Hello verification,
website registration/assertion and installed-package activation remain unverified
until installation is allowed. Do not treat this as a production-ready provider.

The COM provider implements `IPluginAuthenticator`. Windows activates it through
the package's COM declaration. It validates the OS request signature, asks the
user to choose a vault/credential, performs Windows Hello verification and verifies
that signature too. A bounded anonymous-pipe message reaches the unlocked Desktop
agent; the agent independently verifies both signatures through a COM verifier
before creating or signing a key. It rejects repeated request hashes, saves a new
encrypted item before returning success, and returns public CTAP2 response bytes.
Private P-256 PKCS#8 keys remain inside the Rust vault process. Existing encrypted
extension credentials use the same format and can be used by the native provider.
Desktop must be open and unlocked; Hello verifies a ceremony, not vault decryption.

Windows package identity is required. COM registration alone is insufficient.
The package declares only the 127Vaults RoamingAppData directory as an unvirtualized
shared profile, so Desktop, native agents and read-only browser access use the same
encrypted replicas. Windows receives discoverable credential metadata, never keys.
Refresh saved passkeys reconciles the metadata cache after sync/deletion. Locking
does not erase that metadata cache; the provider still refuses key operations
without an unlocked agent and valid OS verification. Unregister removes the Windows
provider and does not delete vault data.

## Build and install locally

Run from the repository root:

```powershell
pnpm --filter @127vaults/desktop exec vite build
cargo build -p vaults-desktop-poc --features tauri/custom-protocol
cargo rustc -p vaults-cli --bin 127vaults -- -C extra-filename=-native-provider
cargo rustc -p vaults-cli --bin 127vaults-extension-host -- -C extra-filename=-native-provider
cargo build -p vaults-cli --bin 127vaults-native-passkey-host
powershell -NoProfile -File apps/desktop/native/windows/build.ps1
powershell -NoProfile -File apps/desktop/native/windows/package.ps1
```

Output: `target/native-passkeys/127Vaults.NativePasskeys.msix` (unsigned) and
`target/native-passkeys/package/AppxManifest.xml` (loose development package).
Alternate CLI filenames let builds proceed without replacing running executables.

After enabling Developer Mode yourself, install the loose package:

```powershell
powershell -NoProfile -File apps/desktop/native/windows/install-development.ps1
```

Open the installed **127Vaults Desktop** from Start, unlock it, and use Settings →
Profile → Register native passkeys. Enable **127Vaults** under Windows Settings →
Accounts → Passkeys → Advanced options. Reload the browser extension and test
Autofill.me registration and authentication without page adjustments. Its Windows
passkey scripts are disabled even if older settings enabled them. Password filling
continues through the read-only connector. The extension's old unpackaged connector
path must be updated separately when switching its password source to an installed
package; native passkeys do not depend on that browser registration.

For a normal installation, sign the MSIX with an appropriate trusted code-signing
certificate whose subject matches the manifest publisher (`CN=127Vaults`). No script
here enables Developer Mode, imports a certificate, changes certificate trust, or
installs without the explicit development-install command. The first unsigned
installation attempt on this machine was rejected with `0x80073CFF`.

The current package is x64, Windows 24H2 build 26100.6725+ / 25H2, ES256, resident
credentials and none attestation. Unsupported CTAP extensions fail closed. Native
save/sign must be validated against real sites and cancellation before release.

## Third-party headers

`include/webauthnplugin.h` and `include/pluginauthenticator.h` are vendored from
[Microsoft's WebAuthn repository](https://github.com/microsoft/webauthn), retrieved
2026-10-09. Microsoft copyright/MIT notices are retained. `include/json.hpp` is
[nlohmann/json v3.12.0](https://github.com/nlohmann/json/releases/tag/v3.12.0), under
its retained MIT license. Builds do not download or execute external source.

Platform API and package requirements:
[Microsoft provider sample](https://github.com/microsoft/Windows-classic-samples/blob/main/Samples/PasskeyManager/README.md).

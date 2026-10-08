# Native passkey provider direction

Researched 2026-10-09. This is a proposed integration, not implemented provider support.

## Windows

Prefer the native Windows passkey manager integration for supported Windows 11
installations. The intended flow is website WebAuthn request → Windows picker →
127Vaults native provider → encrypted vault item and sync. The browser extension
does not need to create or sign credentials on this path and should disable its
WebAuthn interception when the native provider is enabled. Password filling can
remain available through the existing read-only connector.

This requires an actual COM `IPluginAuthenticator` implementation and registration
through `WebAuthNPluginAddAuthenticator`, not a flag declaring that the desktop app
supports passkeys. Handle creation, assertion, cancellation, locked vaults, and
metadata updates/removal; validate OS operation authenticity and relying-party
binding. Keep private keys inside the native vault boundary, persist before
returning registration success, and publish only credential metadata to the OS
cache. Reconcile that cache after sync, edits, deletion, lock and account removal.
Windows Hello verification can replace the extension password prompt only after
verified OS approval and a defined vault-unlock/key-access policy. Hello approval
does not itself decrypt a vault protected by the master password.

Microsoft's current sample requires SDK 10.0.26100.7175 or newer and Windows
24H2 build 26100.6725+ or 25H2 build 26200.6725+. Probe the installed API and
provider support at runtime. Its packaging sample includes an app package
manifest with COM activation; installation, signing, upgrades and unregistration
must be designed for 127Vaults before enabling the provider. Edge/Chrome routing
and actual registration/assertion must be tested with interception disabled.

Sources: [Microsoft API overview](https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/webauthn-apis),
[provider integration](https://learn.microsoft.com/en-us/windows/apps/develop/security/third-party),
[sample and requirements](https://github.com/microsoft/Windows-classic-samples/blob/main/Samples/PasskeyManager/README.md).

## macOS and Linux

Apple provides an AuthenticationServices Credential Provider Extension with
passkey registration/assertion capabilities and an AutoFill entitlement. It needs
a separate native extension target, signing/entitlements and supported OS/browser
testing; it is not the Windows provider API or a Tauri setting.
[Apple documentation](https://developer.apple.com/documentation/AuthenticationServices/ASCredentialProviderViewController).

No equivalent universal Linux desktop provider API was established by this
research. Do not promise native integration across distributions and browsers.
Keep a browser-provider fallback as a separate opt-in if Linux support is required;
KeePassXC documents this approach for its own passkeys.
[KeePassXC guide](https://keepassxc.org/docs/KeePassXC_UserGuide#_passkeys).

The encrypted passkey item format and sync fixes remain useful whichever provider
receives the OS/browser request. Do not remove the experimental extension provider
until a native implementation can register and use existing vault credentials.

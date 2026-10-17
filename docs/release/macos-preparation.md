# macOS preparation — release gated

The user authorized all feasible local preparation on 2026-10-17. There is no accessible Mac, Apple Developer account or GitHub repository yet. Nothing here is evidence of a successful Mac build or consumer installation.

Prepared: Apple-native Keychain feature paths for device identities, agent capabilities and remembered account secrets; shared loopback connector protocol; Chrome/Chromium/Edge registration under `~/Library/Application Support`; native desktop DMG packaging with Intel/Apple Silicon artifact names and a planned macOS 13 minimum. Distribution fails closed without a Developer ID identity and notarization credentials. These changes do not add Safari or native macOS passkey-provider support.

The manual-only [workflow](../../.github/workflows/macos-check.yml) is ready for a future GitHub repository. It uses separate Apple Silicon `macos-15` and Intel `macos-15-intel` runners, performs compile/tests without publishing artifacts, and requires no Apple account for those checks. It has not run. Do not create a repository, push code, spend runner funds or add signing secrets without the user's instruction.

Once a Mac runner exists, first fix compile/runtime issues there. Then exercise Keychain access and app/Chrome native messaging in a logged-in user session, including OS lock/idle, restart, offline edits, conflict replay, connector registration repair and removal. Prepare a Developer ID certificate and either Apple ID/app-specific-password/team credentials or App Store Connect API credentials in a protected signing environment. Package with the existing release tool on the matching Mac architecture, verify codesign/notarization/stapling, then conduct clean-Mac install/update/uninstall tests before adding downloads to the public catalogue. Never document quarantine removal as the consumer installation path.

References: [GitHub runner architecture](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Tauri signing](https://v2.tauri.app/distribute/sign/macos/), [Apple distribution signing](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/).

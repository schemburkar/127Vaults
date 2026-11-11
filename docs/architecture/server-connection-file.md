# Portable server connection file

The local server administration console provides **Connect devices → Share server connection → Download connection file**. Share the `.127vaults-server` file through a channel recipients trust. It is reusable across Windows and Linux Desktop and the shared import code is portable to future macOS builds. No OS paths or installer-specific values are embedded. macOS support still requires its own packaged acceptance.

Desktop's first-run **Connect to your private server → Import server connection** opens a file picker. The app previews the server name/address and requires **Verify and connect** before contacting it. Import validates the bounded schema, installation UUID, private HTTPS address and exact SHA-256 hash of the embedded PEM bytes. Native code checks Tailscale membership when applicable and uses the existing pinned-CA TLS check and create-only trust storage. A differing existing trust profile cannot be silently replaced. The manual setup option remains available.

Version 1 JSON fields: `schemaVersion: 1`, `kind: "127vaults-server-connection"`, `serverName`, `serverUrl`, `installationId`, `caCertificate`, `caSha256`. Only one public PEM CA is allowed. Unknown/duplicate fields and oversized files are rejected by the native importer. Export verifies that the CA signs the server's current TLS certificate. No private key, session, account invitation, license or vault material is included. The server reads its mounted public CA from `/run/secrets/ca.crt` (override `VAULTS_TLS_CA` for custom deployments).

The file's own hash is an integrity check, not independent proof of its sender. The recipient must obtain it from the correct administrator. Import does not enroll an account or grant vault access. Normal account enrollment, vault sign-in and device approval remain required. Network reachability is also required: a loopback deployment cannot serve another computer. Configure the private-LAN or Tailscale endpoint through the existing installation workflow before exporting for other computers.

This slice implements explicit import in Desktop. Double-click file association, QR retrieval, mobile clients and public discovery are separate work; the portable document does not depend on them.

Desktop imports pin the certificate for the application only. They do not silently install system-wide or browser CA trust. Device approval can be completed in the web vault on an existing trusted device. Users opening the web vault on a new computer must separately follow the browser CA-trust instructions in the public setup guide.

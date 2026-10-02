# Selected real-data pilot gate

Status: **not accepted**, 2026-10-02. The user will choose any data; the server does not import or select it. A credential for a live service can still cause harm if disclosed even when it seems low sensitivity. Until this gate is accepted, the supported instruction remains to use fictitious or purpose-created disposable credentials.

The narrow candidate pilot is a single owner on a privately controlled loopback or verified private-LAN test host. It excludes public exposure, shared vaults, browser extension/autofill, recovery claims, and production dependency. Use credentials created for this test or ones that can be rotated immediately without affecting a real account. Record an exit plan to rotate/delete them after testing.

Before any selected real credential is entered:

1. Install the exact offline bundle on the intended host. Verify manifest hashes, CA fingerprint, OS firewall, HTTPS Host/SNI behavior, authenticated readiness and browser owner flow on that host.
2. Keep the host's disk encrypted, restrict operator access, and keep database, identity and their two backup keys in separate protected locations. Rehearse a combined restore and client login on a second isolated project.
3. Exercise device enrollment/revocation, session expiry, wrong-password delay and rollback/fork rejection through the deployed build. Resolve any unexpected log or PostgreSQL plaintext finding.
4. Complete an independent review of the Rust/WASM cryptography, browser key handling, server authentication and deployment boundary. Freeze the exact formats and deterministic vectors used by the pilot.
5. Verify external SMTP if invited users are in scope. Otherwise keep invitations unavailable and use only the bootstrap owner.
6. Record the pilot's exact image hashes, app/schema/crypto versions, endpoint, data scope, backup/restore results, limitations, operator, start date and rotation/deletion date. Do not publish a general real-secret safety claim from a private pilot.

See the [server backlog](../product/server-backlog.md) for implementation state, [test installation](server-test-install.md) for commands and [beta readiness](beta-readiness.md) for a broader release. The independent review and unrelated-host acceptance cannot be completed solely by local automated tests.

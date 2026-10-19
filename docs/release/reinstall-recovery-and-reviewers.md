# Reinstall, replacement and review access

## Reinstall or recover the same installation

There is no reinstall count limit. Use the existing private invitation to download the latest eligible packages. Preserve the protected server identity, configuration, database volume or verified encrypted backup, backup key, signed license and client recovery material. Stop the previous running copy before restoring its replacement. Restore the same installation identity; use the original license and expiry. Do not initialize another identity to recover a database that belongs to the old installation. Verify the installation ID, license status and existing encrypted vault data before reconnecting clients. An expired invitation requires an owner-issued replacement link; it does not require a new trial.

The private page now keeps license/key downloads and recovery instructions visible for activated installations, including those offered an upgrade. First-install activation instructions are hidden after binding. A fresh database plus a replacement license cannot recover lost vault ciphertext or encryption keys.

## Lost identity: request a replacement license

1. Customer retires the old installation and obtains the new installation UUID from their replacement server. The private invitation page accepts the new UUID, a short reason, and confirmation that the old installation is retired. Never send keys, passwords, bootstrap codes or vault contents.
2. The request signs and records revocation of the existing license. Its signed revocation is available to the customer and owner. The old license cannot be downloaded or activated again through this invitation while the request is pending. Downloading packages remains available.
3. A fixed-recipient alert notifies the owner when configured. The request desk shows the pending replacement. The owner checks the request and selects **Issue replacement license**. Only an authenticated operator may issue it.
4. Issuance creates a new license ID bound to exactly the requested UUID, preserving the original plan, user limit, major-version entitlement, trial activation date and expiry. Sequence increases; expiry is never renewed. An expired license cannot request or receive a replacement. Signed revocations and replaced bindings remain in the encrypted audit history.
5. The customer reopens the existing private link and downloads the replacement license. The owner can review the prepared replacement invitation and send it using the existing delivery channel. Issuance itself sends no customer email. If automated invitation delivery is disabled, the owner copies the prepared message and sends it through their email client.
6. The customer installs the replacement license on the replacement server and applies the old-license revocation on the old server if reachable. Reissuing does not remotely stop an offline server. Future centralized Desktop/mobile/generic-web client license and revocation checks are a separate planned enforcement layer; they are not implemented here.

No production customer was rebound while implementing or testing this feature. Concurrency uses the same conditional D1 record updates as approval/activation, preventing conflicting issuance from silently overwriting one another.

## Operator access and release review

The existing operator key is the only request-desk credential. It authorizes request review, release downloads and license replacement. No separate reviewer key or role is required; retired reviewer credentials are not accepted even if a stale Worker secret is retained.

**Review releases** navigates to `/trial?review=1`, reusing the same package table/cards as a customer trial. The page uses the existing one-hour operator session for metadata and downloads through `/api/access-admin/releases`. No key or customer bearer is placed in the URL, no additional sign-in is needed while the session is valid, and opening release review neither creates nor activates a trial. A missing or expired session requires signing in again on the request page. Customer invitation links continue to use their existing independent authentication and major-version entitlement. Operator release review shows the current catalogue; customer activation, license and replacement controls are hidden in that mode.

## Experimental releases

Retaining older major catalogues is not an operational requirement during internal major-0 trial testing. The current major-0 package set replaces previous experimental packages. Before public v1, establish supported-major catalogue retention and publication checks as described in `version-scoped-downloads.md`.

## Verification

Run the relevant intake, Worker, website and publication tests before release.
Deployment identifiers, contact records, backup locations and live acceptance
receipts belong in private operator records, not this behavior guide.

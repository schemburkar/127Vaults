# Reinstall, replacement and review access

## Reinstall or recover the same installation

There is no reinstall count limit. Use the existing private invitation to download the latest eligible packages. Preserve the protected server identity, configuration, database volume or verified encrypted backup, backup key, signed license and client recovery material. Stop the previous running copy before restoring its replacement. Restore the same installation identity; use the original license and expiry. Do not initialize another identity to recover a database that belongs to the old installation. Verify the installation ID, license status and existing encrypted vault data before reconnecting clients. An expired invitation requires an owner-issued replacement link; it does not require a new trial.

The private page now keeps license/key downloads and recovery instructions visible for activated installations, including those offered an upgrade. First-install activation instructions are hidden after binding. A fresh database plus a replacement license cannot recover lost vault ciphertext or encryption keys.

## Lost identity: request a replacement license

1. Customer retires the old installation and obtains the new installation UUID from their replacement server. The private invitation page accepts the new UUID, a short reason, and confirmation that the old installation is retired. Never send keys, passwords, bootstrap codes or vault contents.
2. The request signs and records revocation of the existing license. Its signed revocation is available to the customer and owner. The old license cannot be downloaded or activated again through this invitation while the request is pending. Downloading packages remains available.
3. A fixed-recipient alert notifies the owner when configured. The request desk shows the pending replacement. The owner checks the request and selects **Issue replacement license**. Reviewers cannot issue it.
4. Issuance creates a new license ID bound to exactly the requested UUID, preserving the original plan, user limit, major-version entitlement, trial activation date and expiry. Sequence increases; expiry is never renewed. An expired license cannot request or receive a replacement. Signed revocations and replaced bindings remain in the encrypted audit history.
5. The customer reopens the existing private link and downloads the replacement license. The owner can review the prepared replacement invitation and send it using the existing delivery channel. Issuance itself sends no customer email. If automated invitation delivery is disabled, the owner copies the prepared message and sends it through their email client.
6. The customer installs the replacement license on the replacement server and applies the old-license revocation on the old server if reachable. Reissuing does not remotely stop an offline server. Future centralized Desktop/mobile/generic-web client license and revocation checks are a separate planned enforcement layer; they are not implemented here.

No production customer was rebound while implementing or testing this feature. Concurrency uses the same conditional D1 record updates as approval/activation, preventing conflicting issuance from silently overwriting one another.

## Owner and reviewer access

The existing operator key is the owner key. An independent reviewer key supports request listing, approval/decline, archive/unarchive, invitation-text review and explicit invitation sending. Customer bearer links are redacted from reviewer previews and approval responses. Reviewers may inspect public release metadata and checksums using **Review releases**; they cannot download packages, rotate customer links, close installed access, obtain signed revocations or issue replacement licenses. Owner access retains these functions and can download the current packages directly from release review. All permissions are enforced at the API as well as in the UI, including session cookies.

Enable reviewer access in the private deployment configuration using `reviewerAccessEnabled: true` and a distinct random `reviewer-token` file in the protected secrets directory. Deploy after changing either. Setting the flag to false invalidates reviewer access even if a previous Worker secret remains. Rotating that token invalidates its sessions. Keys remain local and are never committed or embedded in the website. Owner and reviewer sessions use the same sign-in form and expire after one hour. These are shared role keys for the current internal trial, not per-person accounts or a full staff identity system.

## Experimental releases

Retaining older major catalogues is not an operational requirement during internal major-0 trial testing. The current major-0 package set replaces previous experimental packages. Before public v1, establish supported-major catalogue retention and publication checks as described in `version-scoped-downloads.md`.

## Deployment verification

Deployed on 2026-10-18 as Worker `be858786-3234-4ab2-8dfa-1957e96bbe5e` without changing the package catalogue. All 56 intake, Worker, website and publication tests passed. A live synthetic flow verified reviewer link redaction and download denial, owner package access, customer replacement request, cryptographically valid old-license revocation, owner-only issuance, and a valid replacement license preserving expiry and user limits. The synthetic contact was erased afterward; neither existing trial binding changed and no customer invitation was sent. The encrypted database was backed up before deployment. Reviewer credentials, backup and test receipts remain in protected local storage outside Git.

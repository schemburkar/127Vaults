# Internal admin management contract

Status: implementation in progress, 2026-10-12. The user requires management
writes for the internal Windows/Linux release. This contract defines the first
write slice for SRV-016; completion requires database, HTTP and browser evidence.

The console retains its separate loopback-only local operator identity. Local
operator roles authorize console operations; vault account roles never confer
decryption keys. Server owners and admins are account metadata, distinct from
the local operator file. Enrolled recipients accept ownership through their
authenticated vault session, not through an operator impersonating them.

| Action | Local admin | Local owner | Additional condition |
| --- | --- | --- | --- |
| Read users, devices, invitations, audit | Yes | Yes | Current session |
| Create/revoke invitation | Yes | Yes | Fresh operator password; seat/write policy |
| Suspend/reactivate ordinary user or admin | Yes | Yes | Fresh operator password; reactivation seat policy |
| Suspend/reactivate an owner | No | Yes | Fresh operator password; retain an active owner |
| Revoke device or clear authentication lock | Yes | Yes | Fresh operator password; admins cannot target owners |
| Grant/revoke account admin role | No | Yes | Fresh operator password; owner demotion is separate |
| Request/cancel ownership grant | No | Yes | Fresh operator password; active enrolled recipient |
| Accept ownership | No | No | Recipient's own device-bound vault session, authenticated within five minutes |
| Demote an owner | No | Yes | Fresh operator password; retain an active owner |

Every mutation requires exact Origin, the matching session CSRF token, bounded
strict JSON, a unique request ID, and server-side authorization. Writes recheck
the actor's role and target state in a transaction; concurrent ownership and
seat decisions share the installation lock. Repeated identical requests replay
their receipt; divergent request-ID reuse fails. Passwords, session tokens,
invitation bearers, ciphertext and vault labels are excluded from audit entries.
Accepted actions are recorded in the mutation transaction. Denied authenticated
attempts receive a separate redacted audit record.

Suspension revokes all online sessions and blocks future authentication without
deleting device identities, queued changes or encrypted vault data. Reactivation
does not revive old sessions. Offline replicas cannot be erased remotely.
Role changes invalidate old online sessions so permissions must be reacquired.
Owner grants expire after 24 hours, require explicit recipient acceptance, and
never automatically demote the initiating owner. Last-owner protection is also
enforced by a database trigger under a tenant-specific advisory lock. This also
works with the Cloud overlay's restricted installation-table permissions.

The console may display an invitation bearer only after the operator explicitly
creates or retrieves that invitation. Distribution remains an operator action;
this work does not send unsolicited messages. Email verification remains the
existing onboarding ceremony. Restore, migrations, licensing, network changes,
server deletion and secret settings stay in operator runbooks for this release.

Schema 6 remains frozen. Schema 7 adds account suspension, admin roles,
ownership grants, mutation receipts and redacted control-plane audit. Upgrade
requires an authenticated pre-migration backup, dry run, row-count validation,
and restore rehearsal before the internal release can be accepted.

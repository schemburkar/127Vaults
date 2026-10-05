# ADR-0019: Client locking and secret exposure

- Status: Accepted
- Date: 2026-09-06

## Context

Installed clients hold encrypted local replicas and temporarily decrypt data
while unlocked. Lock behavior must be understandable and consistent without
repeatedly interrupting normal password-manager use.

## Decision

An installed client locks when it exits or when the operating system device
locks. While open, it automatically locks after 30 minutes of inactivity.
Server administrators cannot enforce a different maximum in v1.

Unlocking the application with the master password unlocks accessible vaults.
Revealing, copying, or editing an item does not request the master password again.

Passwords and TOTP codes copied to the clipboard are cleared after 30 seconds.
This interval is fixed in v1. Clipboard clearing is best effort because operating
systems, clipboard history, synchronization, and other applications may retain
copied data.

Locking destroys decrypted item material and usable in-memory vault keys to the
extent supported by the runtime. The encrypted local database remains present.
Exact zeroization guarantees must be documented per client/runtime.

Screenshot and screen-recording protection is postponed to v2.

The browser extension should eventually share lock state with an installed
127Vaults application. V1 may use an independent extension lock if native
messaging and shared-unlock work would delay the secure vertical slice.
Its independent unlock covers a local encrypted read-only replica; an unlocked
web tab is not required for offline autofill.

Unresolved conflicts display an in-app count and a highlighted sidebar section;
they do not generate ordinary external notifications.

## Consequences

- An unlocked session supports normal reveal, copy, edit, and autofill without
  repeated password prompts.
- Clipboard clearing reduces casual exposure but is not an erasure guarantee.
- A browser-extension lock may initially differ from the desktop lock state.
- The 30-minute inactivity policy is intentionally simple and not configurable
  in v1.

# Experimental login item and session components

`packages/domain/src/login-item.mjs` contains a client-only plaintext model for
title, username, password, URLs, and custom fields. Do not send this object to the
server. It has no wire-format or cryptographic-format status, persistence, or
encryption behavior. The general domain entry point does not re-export it.

The model copies and freezes accepted collections. It preserves exact text,
including password whitespace and Unicode composition. It rejects malformed
Unicode, unknown properties, non-HTTP(S) URLs and embedded URL credentials.
Provisional resource limits are measured in JavaScript UTF-16 code units: title
512, username 4096, password/custom value 16384, URL 4096, custom name 128,
20 URLs, 50 custom fields. These limits need import/browser compatibility review.
Empty usernames/passwords are allowed; titles and custom-field names are required.
Concealed fields are a display hint, not separate protection.

`createLoginIndex` returns only title and deduplicated URL hostnames. This is
client display metadata, not public server data or an autofill matching policy.
It currently starts from plaintext; the future crypto layer must encrypt the
index independently so listing items does not decrypt their bodies.

`apps/web/src/login-session.mjs` stores at most one current plaintext item. It
starts locked. The integration must finish reviewed key unlock/authentication
before calling `beginAfterUnlock`; that method is deliberately not a password
check. There is no usable authentication flow yet.

The session locks after 30 minutes without explicit user activity, at timer
execution or the next read/status/activity check. Delayed browser timers cannot
permit a read past the deadline. Background sync must not count as user activity.
A backwards or invalid clock locks conservatively. Calling `lock` clears the
current item reference; `dispose` also prevents reopening the component.

JavaScript cannot guarantee zeroization of strings, garbage-collected objects,
caller-held references, or copies in browser tools. Returning an item lets the
caller retain a reference. Client integration must clear rendered UI, closures,
clipboard handlers, and Rust key handles on lock. This component presently holds
no vault keys. Batch 2 wires its synchronous `onLock` callback to a disposable
Rust fixture store and clears the demo on page exit; see the browser runbook.
Real key destruction, installed-client OS-lock signals and vault UI integration
remain pending. A web page
cannot promise reliable OS-lock detection. No decrypted local storage is added.

## Verification — 2026-09-06

Ad hoc runtime checks passed for exact secret preservation, copied custom fields,
minimal index output, unsafe URL refusal, initially locked state, reads before
the deadline, refusal at the deadline without running the timer, timer-driven
locking after activity, backwards-clock locking, and refusal to reopen after
disposal. `pnpm check` passed. No unit tests were added; browser and adversarial
coverage are tracked in the implementation backlog.

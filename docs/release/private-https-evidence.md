# Batch 5T private HTTPS evidence

Implemented 2026-09-09 for disposable internal-MVP use.

## Implemented

- Direct Node HTTPS only, TLS 1.2–1.3; invalid key material stops startup.
- Separate bind, endpoint, and publication identities; loopback or one exact
  RFC1918 IPv4 only. Wildcard, public, mismatched, and custom-domain inputs fail.
- Exact Host, Origin, supplied SNI, and forwarded-header rejection before routes.
- Version-pinned `alpine/openssl:3.5.4` offline helper creates a P-256 five-year
  root and independently keyed 90-day leaf with exact SAN, random 128-bit serial,
  five-minute backdate, required extensions, staged validation, and atomic renewal.
- The CA key stays outside the repository and application mount. Compose mounts
  only the leaf pair and public CA and publishes only the configured address.

## Reproduced

Server syntax and three policy tests pass. Tests cover accepted loopback/LAN
configuration and wrong/public/wildcard/custom publication, Host, Origin,
forwarded headers, and SNI.

## Runtime evidence (2026-09-09)

On Windows/Podman, loopback container startup and readiness passed with the local
CA. Correct Host passed, wrong Host returned 403, and wrong SNI failed the TLS
handshake. A fresh init then renewal preserved the CA and atomically replaced the
leaf. Fixes required an explicit OpenSSL image entrypoint, correct initial live
promotion, Windows-safe modes, no ACL reset during renewal, and long Compose bind
mounts. The CA-verified loopback/absent-SNI, wrong-Host, and wrong-SNI probes were
repeated on 2026-09-10. Browser trust/untrust, private-LAN binding and immutable
image digest review remain before claiming LAN support.

# ADR-0012: Private network exposure

- Status: Proposed
- Date: 2026-09-06

## Security objective

127Vaults does not offer a generic “listen publicly” or public reverse-proxy
deployment mode. Installation is fail-closed: the process refuses wildcard,
unspecified, or globally routable bind addresses and requires one explicit access
mode. Application authentication, encryption, rate limits, and device authorization
remain mandatory even on trusted private transport.

No application can prove that an operator has not placed a separate NAT, port
forward, relay, or proxy in front of it. The enforceable guarantee is that official
configuration does not bind a public interface, does not trust arbitrary forwarded
headers, and accepts only the configured connector/host path.

## Access modes

The accepted internal MVP supports loopback and one documented private-LAN HTTPS
setup. A bundled TLS endpoint uses an installation-specific local certificate
authority; operators manually install its public trust certificate on test devices.
Do not distribute its private signing key to clients. Reject untrusted certificates
and never instruct users to bypass browser warnings. Exact endpoint allowlists
remain mandatory. The [MVP transport contract](../security/mvp-onboarding-transport.md#private-https-operational-contract)
specifies direct Node HTTPS termination, host-only CA provisioning, protected key
storage, manual renewal and exact container publication. Its implementation and
browser verification are required before claiming LAN support. Tailscale and
Cloudflare modes below remain later delivery targets.

### Local

Bind only to loopback. Accept only normalized loopback authority values configured
by the installer. This is the default.

### Private LAN

Bind to one explicitly selected private interface/address. Do not infer that every
interface is private merely from its name. Startup rejects a globally routable
address. The operator configures exact allowed hostnames or IP authorities.

### Tailscale

Bind to the explicitly discovered Tailscale interface/address, not `0.0.0.0` or
`::`. Accept the exact configured Tailscale IP and optional MagicDNS name. Address
range alone is insufficient proof of Tailscale because its IPv4 range overlaps
the broader carrier-grade NAT space. Tailscale identity information supplements,
but does not replace, 127Vaults device authentication.

### Cloudflare private route

The origin binds to loopback or a connector-only private network and is reachable
only by `cloudflared`. The supported private mode uses Cloudflare private-network
access/WARP rather than an anonymously published application hostname. Connector
authentication, exact expected authority, TLS verification, and a catch-all deny
route are required.

A Cloudflare published-application route creates a public DNS hostname and a
publicly reachable Cloudflare edge, even though the origin has no inbound port.
That is materially different from “not exposed to the Internet” and is not an
approved deployment mode under this ADR. Supporting it later would require a new
ADR mandating Cloudflare Access and origin authentication.

## DNS and proxy defenses

The server cannot reject all DNS-based access: legitimate private names such as
MagicDNS resolve through DNS, and HTTP/TLS require authority/SNI validation. It
instead rejects any `Host`, HTTP/2 `:authority`, forwarded-host, or TLS name not in
an exact configuration-generated allowlist. Wildcards and suffix-only matching are
not allowed initially.

Forwarded headers are ignored unless the immediate peer is the configured local
connector and the connector uses an authenticated channel. Requests with multiple,
conflicting, malformed, Unicode-confusable, or non-canonical authority values fail
closed. WebSocket and future HTTP/3 paths use the same policy.

## No arbitrary custom domains

127Vaults endpoint identities are generated or enrolled by the selected access
adapter; there is no generic `public_url`, custom-domain, or “trust first Host”
setting. Pointing `mydomain.com` at a 127Vaults address through a DNS provider does
not register that domain and does not make it acceptable to the server.

The initial allowlist contains only identities that can be bound to the active
mode:

- canonical loopback names and literal addresses for local mode;
- the selected literal private address for private-LAN mode;
- the exact Tailscale address and MagicDNS name discovered from the local
  Tailscale control state;
- an exact connector identity generated during Cloudflare-private enrollment.

Arbitrary registrable domains, wildcard names, user-entered suffixes, and names
learned from incoming requests are rejected. The same canonical endpoint identity
must match TLS SNI/certificate policy, HTTP `Host` or `:authority`, browser
`Origin`, WebSocket origin, CSRF policy, and the WebAuthn relying-party ID. A
mismatch fails before application authentication.

Literal-IP access may omit SNI. On that single configured endpoint, validate the
exact IP certificate SAN and HTTP authority; do not require a DNS SNI value from
IP clients. A supplied SNI value must still match the configured endpoint.

When practical, the server periodically confirms that an allowed name still maps
to the selected interface/connector. DNS resolution is supporting evidence only:
split-horizon DNS, caching, rebinding, and proxy rewriting mean resolution cannot
be the root of trust.

This resembles a managed platform's unregistered-custom-domain rejection for
official binaries and configurations. It is not DRM: a self-hosting machine owner
can modify source, patch a binary, or run a proxy that rewrites an arbitrary public
hostname to an allowed internal authority. Documentation must describe the feature
as secure-default exposure control, not proof that public hosting is impossible.

## Required verification

Release tests must cover wildcard binding refusal, IPv4/IPv6 loopback, private and
global address classification, container port publication, DNS rebinding Host
changes, forwarded-header spoofing, Tailscale interface loss/reassignment, tunnel
connector bypass, unregistered custom domains, SNI/Host/Origin disagreement,
WebAuthn RP mismatch, and startup after network configuration changes.

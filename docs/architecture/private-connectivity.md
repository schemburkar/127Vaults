# Private connectivity and operator control

Decision checkpoint, 2026-10-17. Preserve loopback as the default. Reject wildcard/public publication in supported setup. A machine administrator can still configure another proxy, change firewall rules or alter software. Loopback, RFC1918 validation and licensing cannot prove that an administrator has not exposed a service. Describe this as a supported private deployment boundary, never as an absolute prevention of Internet hosting.

| Path | Exposure and proposed support |
| --- | --- |
| Same computer | HTTPS on loopback, pinned installation CA and identity; default |
| Tailscale | Native discovery plus Serve TCP forwarding to the loopback HTTPS service; tailnet grants/ACLs restrict users/devices; Funnel refused |
| Intranet | Explicit RFC1918 interface only, exact HTTPS Host/Origin, host firewall restricted to approved subnets, no router port forwarding; operator-managed alternative |
| Cloudflare private routing | Explore WARP-enrolled clients plus a private IP/hostname route and Access/Gateway policy; no published public application hostname |
| Cloudflare public hostname with Access | Publicly routed endpoint with identity controls; distinct from a private network and outside the selected private-only offering |

Tailscale setup uses `tailscale status --json` to obtain the local device identity; visitors cannot assert a CGNAT address without matching that state. The new server mode publishes only `127.0.0.1:12780`. `tailscale serve --bg --tcp=12780 tcp://127.0.0.1:12780` forwards encrypted TCP without terminating TLS. The server certificate names the discovered tailnet address, and exact Host/Origin/SNI checks remain in force. Native clients discover online peers, while the operator still supplies the installation ID and public CA through a trusted channel. Discovery is not authentication or an account approval.

Before claiming Tailscale support, test published packages on two computers: discovery, verified HTTPS, owner/device approval, sync, disconnected-client recovery, wrong-host/origin refusal, and unreachable non-tailnet interfaces. Do not change an existing loopback installation's origin as part of a binary upgrade. A later network migration renews the server certificate under the same CA and deliberately updates client trust while preserving the installation/database identity.

Cloudflare needs a separate design and acceptance pass. Published application routes create public DNS endpoints; adding Access does not turn those endpoints into intranet-only listeners. Private IP routing through WARP can preserve end-to-end application TLS, but a connector on another machine cannot reach a server's loopback. Either co-locate it with a supported local forwarding arrangement or use an explicitly firewalled private interface. Private hostname routing may resolve through Cloudflare-owned addresses; today's client allowlist must not be widened to arbitrary public addresses to accommodate that. DNS, routing attestation, certificate/identity pinning and native-client authentication need review together. No Cloudflare deployment is automatically enabled by these changes.

Sources checked on 2026-10-17: [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [TCP forwarding command](https://tailscale.com/docs/reference/tailscale-cli/serve), [Cloudflare routing](https://developers.cloudflare.com/tunnel/concepts/routing/), [Cloudflare private hostname routing](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/connect-private-hostname/).

# Pricing and plan summary

Core prices are in US dollars and summarize the adopted
[Commercial License Agreement](../../COMMERCIAL-LICENSE.md). The agreement and
accepted order control; this summary does not create an order or open checkout.
Taxes, support and any service-pause terms must be specified in the order.

## Core products

| Product | Standard price | Billing/commitment | Hosting |
|---|---:|---|---|
| Personal self-hosted | $20/year | Annual production license | Customer |
| Commercial self-hosted | $200/year | Annual billing; 5- or 10-year commitment | Customer |
| 127Vaults Cloud | $30/user/year | Annual upfront; 2-year commitment | 127Vaults |

Cloud has one tenant and one per-user price model for individuals, families, and
companies. A tenant may start with one licensed vault user and add seats later;
there is no Personal-to-Team conversion. The tenant's control owner is a
separate public/customer identity and is not a licensed vault user merely by
administering billing or seats. If that person also registers a vault account,
that vault account consumes a seat. The first vault user consumes one seat.
The two-year commitment remains; a service pause is not early contract
cancellation. Its billing and access effects need explicit contract terms.

Commercial self-hosted customers receive software updates and major-version
upgrades released during the active contract period. Personal covers the purchased
major version; renewal does not require a major-version upgrade. Moving to another
major version is optional and requires a separate license. Self-hosted plans allow
additional users on request without a per-user license charge.

After self-hosted expiry, the agreement permits 30 calendar days of read/export
solely for retrieval or renewal; operation afterward requires renewed permission.
This is not a claim that every offline client technically locks. Expiry does not
delete encrypted data or keys, and renewal cannot guarantee restoration or
decryption. See [ADR-0004](../adr/0004-license-state-is-not-key-destruction.md).

## Hosted security-email relay

The optional relay sends only fixed recovery and security-alert templates from an
official 127Vaults domain. It does not deliver invitations or arbitrary/custom
email content.

| Relay tier | Proposed price | Included use |
|---|---:|---|
| BYO SMTP | Free | Operator pays and manages their provider |
| Personal Relay | $5/year per licensed server | Household recovery/security alerts |
| Commercial Relay | $25/year per licensed deployment | Organization recovery/security alerts |
| 127Vaults Cloud | Included | Subject to service anti-abuse limits |

Relay pricing is provisional until delivery, bounce, support, fraud, and abuse
costs are measured. Any launched relay tier must have conservative code- and service-enforced limits;
there is no bulk-email overage product. Exceeding a limit pauses relay delivery and
alerts the operator rather than generating surprise usage charges.

The relay remains optional. Choosing BYO SMTP does not reduce core security or
recovery capabilities, and relay purchase never grants the service access to vault
contents. Metadata disclosure and technical boundaries are defined in ADR-0016.

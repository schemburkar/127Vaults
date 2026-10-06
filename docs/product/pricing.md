# Pricing model (planning draft)

Prices and entitlements in this document are product decisions, not an offer,
quote, or contract until checkout and legal terms are approved. Taxes, currency
localization, support terms, and the meaning of a service pause remain to be defined.

## Core products

| Product | Planned price | Billing/commitment | Hosting |
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
upgrades released during the active contract period. Final Personal major-version
upgrade terms remain a product/legal decision.

An expired self-hosted license provides 30 days of read-only access, then locks
vault access until a valid license is installed. Expiry never deletes encrypted
data or key material. See ADR-0004.

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
costs are measured. Each tier has conservative code- and service-enforced limits;
there is no bulk-email overage product. Exceeding a limit pauses relay delivery and
alerts the operator rather than generating surprise usage charges.

The relay remains optional. Choosing BYO SMTP does not reduce core security or
recovery capabilities, and relay purchase never grants the service access to vault
contents. Metadata disclosure and technical boundaries are defined in ADR-0016.

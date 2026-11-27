# Personal subscription settlement

## Provider contract checked on 2026-11-13

Official references:

- [Payment detail](https://docs.dodopayments.com/api-reference/payments/get-payments-1)
- [Subscription detail](https://docs.dodopayments.com/api-reference/subscriptions/get-subscriptions)
- [Invoice detail](https://docs.dodopayments.com/api-reference/invoices/get-invoice)
- [Payment discovery](https://docs.dodopayments.com/api-reference/payments/get-payments)
- [Discount retrieval](https://docs.dodopayments.com/api-reference/discounts/validate-discount)
- [Card-optional subscriptions](https://docs.dodopayments.com/changelog/v1.113.28)

Payment detail supplies applied discount snapshots, customer/business identifiers,
checkout/subscription references, charge type, currency, amount and service periods.
Subscription detail supplies current state and period boundaries. Structured
invoice retrieval uses `/billing/invoices/{invoice_id}`, not the invoice PDF
endpoint. Payment listings are discovery only; candidates require detail retrieval.

An actual Dodo Test checkout and recurring renewal were observed on 2026-11-13.
Both succeeded at zero with a customer-restricted, product-restricted indefinite
100% discount. Sanitized authenticated resource fixtures are committed under
`apps/public-intake/test/fixtures/dodo-zero*-observed.json`. No card was required.
The synthetic subscription was cancelled after verification.

## Shared decision

`settlement.mjs` owns the decision; `settlement-provider.mjs` retrieves evidence
for webhooks, reconciliation and customer/server license refresh. Downloads,
setup links, installation activation and customer views share the resulting
entitlement predicate through `paidPersonalAccess`.

Positive payments require an active normal subscription, matching
business/customer/order/environment/product/quantity/currency, a successful
period charge, a matching initial checkout and an exact service period. A prior
payment cannot extend a future period. Refunded/disputed evidence cannot grant
a new period.

Zero additionally requires a paid invoice with zero balance/customer payment,
no wallet credit or refund/dispute indicators, one matching subscription line,
a positive configured normal unit price and matching applied discount snapshots.
Exact integer percentage/flat stacking must cover that charge. Unknown rounding,
mixed carts, proration and incomplete evidence stay pending with bounded reasons.
A trial, mandate, attached coupon or zero amount alone cannot grant access.

Configure supported normal prices in the server-owned plan, for example:

```json
{"personal-annual":{"productId":"pdt_example","plan":"personal","majorVersion":0,"maxUsers":5,"prices":{"USD":2000}}}
```

This example does not change production configuration. Country-localized prices
that differ within one currency require a verified pricing adapter; an unmatched
normal price stays pending. Zero tax and integer currency minor units are checked
rather than guessed. Mixed-product invoices are unsupported.

Applied payment snapshots remain valid after coupon redemption expiry or when
future cycle count reaches zero. Every renewal requires a newly confirmed period.
Legacy subscription invoice IDs can return 404 from the structured invoice API.
That observed path uses authenticated `/payments/{id}/line-items`: one matching
product, zero line amount/tax/refundable balance, zero payment tax, no subscription
add-ons/meters, zero recurring amount, a positive configured normal price and one
applied 100% percentage snapshot. All normal binding and period checks still apply.
Other missing evidence remains pending.

For an adaptive-currency zero checkout, request the native payment line items
without a currency override. The customer-facing payment and merchant settlement
must both be zero with zero tax. The native line must match the subscription
currency and product, and a single applied 100% discount must be restricted to
that product. The exact current billing period is still required. The next
recurring amount may be positive, and the service does not infer a historical
pre-discount price or tax from it.

Confirmed periods use ordinary Personal licenses, existing seats/version policy,
the selected installation and monotonic sequences. Duplicate events do not
reissue a period. Test decisions cannot grant production Personal downloads or
licenses. Previously confirmed positive-payment periods remain usable during
migration; that compatibility path cannot advance expiry.

Missed refund/dispute notifications can be recovered by reconciliation. It
persists suspension and the signed revocation before requesting provider
cancellation. Provider outages leave a durable cancellation retry marker without
preventing a server from receiving its revocation. Retries retain the same
revocation instead of producing duplicate signatures.

## Checkout and presentation

Customer-entered codes are enabled in hosted checkout and the authenticated
billing form. Dodo enforces eligibility; product and quantity remain server-owned.
Email editing is disabled and the returned customer email must match the order.
Durable reservations still precede provider calls, preventing ambiguous retries
from creating duplicate subscriptions. There is no owner-email exception,
complimentary plan or browser entitlement override.

Private codes must have provider customer/product restrictions. Creating the
owner's live recurring discount requires separate explicit authorization.
Customer status exposes price, discount and zero due amount without codes or
unnecessary PII, and confirms subscription settlement rather than positive
payment. Billing identity does not create a local operator or grant vault access.

## Verification boundary

Observed Test resources cover initial and indefinite-discount renewal settlement.
The fixtures retain their resource shapes and period semantics while removing
customer information and provider identifiers. Reordered/duplicate notifications,
finite cycles, refund recovery and ordinary license issuance use local integration
tests. API observations do not claim an observed webhook delivery sequence or
provider fee guarantees. No live billing object, production sign-in code, probe
email or production test signup was created. No deployment is part of this review.

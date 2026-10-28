# Dodo subscription integration

Implemented 2026-10-28. Billing is disabled unless the deployment explicitly includes its Dodo configuration. The public website keeps **Request access**. No Dodo account, remote deployment, or real transaction was created during implementation.

## Boundaries and entitlement policy

The deployed Cloudflare intake/licensing Worker owns private subscription offers, checkout, encrypted payment events, reconciliation, coupon operations, and signed entitlement renewal. The filesystem Node intake remains the legacy trial/mock development service; it is not the billing deployment. Dodo hosts checkout and its customer portal. Card details never pass through 127Vaults. Billing identity never authenticates a vault or conveys vault encryption keys.

Only an operator-approved, activated installation can buy an offered subscription. A configured plan maps one Dodo recurring product to the commercial license plan and a fixed user limit. The browser cannot set price, quantity, product, trial length or seat limit. Annual and monthly products can have separate slugs. Configure products with no provider trial; the existing private trial is separate. Personal perpetual-major licensing and provisioning a new Cloud tenant are not sold through this subscription endpoint: they have different product/provisioning contracts and are rejected rather than charged without fulfillment. Existing server, web, Desktop, CLI and extension enforcement all use the same installation entitlement; there is no additional payment identity in a vault client or sync/index data path.

A verified webhook triggers an authenticated GET of the current subscription. An active, matching subscription issues an Ed25519 license through the next billing date with a higher sequence. Repeating the same state does not issue another license. A return URL, payment failure, stale webhook, or client claim cannot extend expiry. The signed expiry is the paid-period boundary: writes stop at expiry, reads/exports continue for 30 days, then access locks. Ciphertext and backups remain intact. Dodo handles collection and retries; configure its customer notification/dunning policy during onboarding. Hourly reconciliation cancels subscriptions still on hold, past due or paused at the end of the local 30-day grace. Cancellation at period end preserves the existing paid license until its normal expiry and recovery period.

Webhook signatures follow Standard Webhooks over the exact raw request body, with a five-minute timestamp tolerance, business ID check and optional previous signing secret. D1 stores encrypted events before processing and marks completion only after success. Provider failures return a retryable response. Event IDs deduplicate deliveries. Per-record compare-and-swap writes protect concurrent renewal/approval operations; conflicts return 409 for retry. Reconciliation also discovers the initial subscription through checkout -> payment -> subscription when an initial webhook is missed. It records checked/failed counts for operator inspection. Provider state is retrieved again for delayed events rather than applying old payload state.

The payment ledger records payments, failures, refunds and disputes. Full refunds of the newest observed successful payment, and lost disputes for that payment, suspend renewal, cancel the provider subscription and generate an installation-bound signed revocation when its provider service period covers the current paid period. Partial refunds do not revoke service. Refunds for older service periods cannot revoke a newer paid period, even when a newer success webhook was missed. Missing service-period data requires operator review. Suspended subscriptions require operator investigation; a new offer can be issued after confirming provider cancellation. Revocations and expiry cannot instantly disable an offline installation: it retains its last signed state until it reconnects or that license expires. An operator controlling the host can modify clocks, state or binaries; application licensing is not a hardware trust boundary.

## Account setup and test-mode acceptance

1. Create the Dodo merchant account later. Use its **test mode** first. Create recurring products with the intended price, currency and billing interval, no provider trial, and the agreed tax/refund/customer-notification settings. Do not infer product IDs or prices from this repository.
2. Add a `billing` object to the protected Cloudflare deployment configuration (see example below). Write `dodo-api-key` and `dodo-webhook-secret` into the existing protected secrets directory. Never add these files to source, a public asset, a customer archive, or a receipt. Existing deployment scripts load and publish secrets through their protected temporary secret file and scan delivery payloads for configured secret material.
3. Configure the Dodo webhook URL as `https://YOUR-ORIGIN/api/billing/webhook`. Subscribe to all subscription, payment, refund and dispute events. The endpoint requires no browser Origin header, but always requires a valid signature. Record the actual business ID and signing secret. During secret rotation, `DODO_WEBHOOK_SECRET_PREVIOUS` can be set temporarily; remove it after the overlap period.
4. Use the existing coordinated release build/publication scripts when deploying a release. Their D1 migration application installs `0002_billing.sql`; the Worker, private pages and updated server must be deployed together. This implementation task does not publish packages. Run `pnpm test:billing` first. Its receipt is `.cloudflare-deploy/billing/verification.json`.
5. Sign in at the private access desk. Approve and activate a disposable test installation normally. In the private subscriptions panel, show configured plans and request IDs, choose the matching request, and offer its subscription. Offering creates no charge and downloads a private `subscription.json` with a machine-only refresh credential. Share it securely only with the installation operator. Open the original private invitation and select **Manage subscription** to reach checkout.
6. On the server bundle, install its initial signed license and configure refresh:

   ```text
   node server.mjs install license --file trial-license.json
   node server.mjs install subscription --file subscription.json
   node server.mjs install start
   ```

   The refresh credential cannot open checkout, view invoices or change payment methods. It can retrieve only that installation's signed license. The server verifies signatures, installation binding and increasing sequences against its existing pinned issuer keys. It keeps accepted state in `/run/runtime/subscription-license.json`, checks at most every 15 minutes during entitlement checks, and retries failed refreshes after one minute. Network outages preserve the last signed expiry; they never extend it. Runtime state is separate from read-only deployment secrets. Identity backup/restore and upgrades preserve the subscription configuration and signed state.
7. In Dodo test mode exercise initial payment, renewal, failed payment/retry, recovery before grace expiry, cancellation, grace exhaustion, full/partial refunds, dispute handling, invalid/expired/exhausted coupons, and 100% discounts. Verify real payloads, invoice/portal links, product metadata propagation and the no-payment-method behavior of free recurring purchases. Reopen the private invitation after the hosted redirect: redirect parameters never authorize service. Inspect the operator reconciliation status and payment ledger.
8. Confirm connected web/Desktop/CLI clients get the new server status, writes stop at signed expiry, reads/exports stop after grace, and offline caches obey the same dates. Existing client regression tests cover this policy; real provider/installed-binary acceptance is still necessary once the account and coordinated packages exist.
9. Switch the configuration explicitly to `live_mode` only after test acceptance, with separate live business/products/API key/webhook secret. Keep Request access in place. Do not mix an existing test order with live mode; use a fresh request/order. No API key or signing secret is needed until account setup, and no mock path can turn into a paid entitlement.

Example protected configuration fragment (replace product/business placeholders with real test values):

```json
{
  "billing": {
    "mode": "test_mode",
    "businessId": "YOUR_TEST_BUSINESS_ID",
    "plans": {
      "commercial-annual": {
        "productId": "pdt_REPLACE",
        "plan": "commercial",
        "maxUsers": 5
      }
    }
  }
}
```

Omitting `billing` renders `DODO_ENABLED=0`, including after a previous enabled deployment. Retained provider secrets alone cannot enable checkout. The configuration defaults to test mode; it never defaults to live mode.

## Operations and recovery

All browser mutations require same-origin JSON and the existing authenticated operator cookie or private invitation bearer. Webhooks use provider signature authentication instead. Do not put operator, invitation or refresh credentials into query strings or logs. Private invitations carry a fragment token, cleared from the address bar after parsing; links still expire/rotate under the existing private-access policy. Rotate an expired invitation through the access desk to restore billing access without changing the subscription.

The Worker acknowledges a webhook after durable encrypted storage, then processes it with its execution context. Scheduled reconciliation replays up to 50 pending events per run, including events whose provider delivery retries were exhausted. Current provider state is retrieved again during replay. A persistent server state lock serializes refresh with other server/provisioning processes. An orphaned `subscription-license.json.lock` is recovered only with the server stopped; never steal a live process's lock. Until recovery, the last signed entitlement still expires normally. Manual license installation and revocation also respect the newer automatically renewed license. During installation replacement, the retired server receives its old signed license plus its matching signed revocation; it never adopts the replacement installation's entitlement.

The operator API prefix is `/api/access-admin/billing`; it uses the same authenticated operator session as the access desk. The customer API prefix is `/api/billing/REQUEST_ID`; it uses the approved invitation bearer. The following API routes support operational recovery as well as the private panel:

| Route | Purpose |
| --- | --- |
| GET operator `/plans`, `/health` | Configured plans; last reconciliation and pending event counts |
| POST operator `/REQUEST_ID/offer` with `{ "plan": "commercial-annual" }` | Create a private offer, or reoffer after a confirmed terminal subscription |
| POST operator `/coupons` | Generate a provider-enforced recurring percentage discount |
| POST operator `/coupons/DISCOUNT_ID/revoke` | Delete a code for future checkout redemption |
| POST operator `/REQUEST_ID/rotate-refresh` with `{}` | Replace a lost/compromised machine refresh credential; install its returned configuration again |
| POST operator `/REQUEST_ID/recover-checkout` with `{ "sessionId": "cks_ACTUAL" }` | Recover a checkout response lost after provider creation; validates the resulting subscription against the saved order |
| GET operator/customer `/REQUEST_ID/payments` | Latest 100 redacted payment/subscription events |
| GET customer request root | Status, paid-through date and local recovery deadline |
| POST customer `/checkout` with optional `{ "coupon": "CODE" }` | Hosted checkout for the offered product |
| POST customer `/portal` with `{}` | Dodo invoices, payment methods and supported subscription self-service |
| POST customer `/cancel` with `{}` | Cancel at the next paid-period boundary |
| POST customer/machine `/refresh` with `{}` | Reconcile and retrieve signed license/revocation |
| GET customer `/license` | Current license download envelope |

Checkout reserves the order before the provider call. Concurrent clicks cannot create duplicate subscriptions. Definite validation rejection (400/422) reopens the offer; ambiguous timeouts leave it pending. Do not manually reset a pending order and risk duplicate billing. Recover it with the actual Dodo checkout session ID, or let a correctly bound webhook complete it. To retry after a confirmed terminal subscription, reoffer through the operator API/panel; prior order bindings are retained so late events cannot overwrite the new order. A subscription changed to an unconfigured product or quantity fails closed; coordinate supported plan changes with the configured product contract instead of trusting portal fields.

Coupon creation takes `plan`, `basisPoints` (1–10000), `cycles` (1–1200), `usageLimit` (1–10000) and `expiresAt` (within the next 366 days). 10000 basis points is free; 9900 gives 99% off for a nominal price. Codes are random, restricted to the chosen product, expire, and permit one redemption per customer; Dodo enforces the global usage limit and cycle count. Coupon deletion stops new redemption; existing subscriptions retain their already agreed discounts. Do not revoke an existing discount by unexpectedly changing a customer's price.

Paid account/contact records are excluded from trial's 90-day deletion, because ongoing collection, renewal, disputes and accounting require them. Events are separately encrypted under the intake key with event-ID associated data. Operational financial retention/erasure must be set against the merchant's actual obligations during onboarding; the generic trial erase/extend/close actions are blocked for billed records. Billing APIs expose no contact details to vault users. The machine receives no payment ledger or provider customer identity.

## Public documentation used

- [Dodo checkout sessions](https://docs.dodopayments.com/api-reference/checkout-sessions/create)
- [Dodo checkout status](https://docs.dodopayments.com/api-reference/checkout-sessions/get-checkouts)
- [Webhooks and Standard Webhooks signature/retry rules](https://docs.dodopayments.com/developer-resources/webhooks)
- [Subscription retrieval](https://docs.dodopayments.com/api-reference/subscriptions/get-subscriptions)
- [Subscription cancellation/update](https://docs.dodopayments.com/api-reference/subscriptions/patch-subscriptions)
- [Hosted customer portal](https://docs.dodopayments.com/api-reference/customers/create-customer-portal-session)
- [Discounts, basis points, product restrictions and cycles](https://docs.dodopayments.com/api-reference/discounts/create-discount)

Documentation was consulted on 2026-10-28. The local suite uses signed synthetic payloads, a mock HTTP provider and real local D1/R2 execution. It does not substitute for later Dodo account testing or a real transaction.

# Dodo billing implementation verification — 2026-10-28

Scope: disabled-by-default private Dodo subscriptions for the existing installation licensing system. The public Request access flow is retained. No account, deployment, publication, push, or live charge was performed.

Checks performed:

- `pnpm check`: passed, including server syntax, TypeScript contracts, web/Desktop production builds, extension checks and Desktop Rust compilation.
- `pnpm test:billing`: repeatable billing gates, signed webhook/replay tests using local D1/R2, provider mocks, automatic license refresh, expiry, revocation, client enforcement, backup and deployment checks. The exact command results, source revision and changed-file digests are retained in `.cloudflare-deploy/billing/verification.json`; console output is retained beside it in `verification.log`.
- `pnpm -r --filter '!@127vaults/api-contract' test`: all selected workspace package suites passed, including complete server, web, Desktop and extension tests.
- The additional root Node test suites (acceptance/internal structure, intake, public website, deployment, operations, release tooling and Cloudflare): 210 tests passed during the broad regression run. Output is retained in `.cloudflare-deploy/billing/regression.log`.
- `node public-website/validate-releases.mjs`: passed; public release downloads remain empty.
- `git diff --check`: passed.

The aggregate `pnpm test` stops on an existing API-contract inventory mismatch: `packages/api-contract/openapi-v1.json` omits `POST /api/v1/devices/rotate-password/start` and `POST /api/v1/devices/rotate-account-secret/start`, while `docs/architecture/api-v1-contract.md` lists them. Those files were unchanged by this work. Remaining workspace/root test suites were run separately rather than allowing that failure to hide regressions.

Account-dependent Dodo acceptance remains intentionally pending: real test products/keys, webhook registration and payloads, payment-method updates, invoices, renewals, dunning, coupon exhaustion/free-checkout behavior and installed coordinated packages. See [the setup and operations runbook](../architecture/dodo-subscriptions.md). Cloud tenant provisioning and Personal perpetual-license purchases are separate fulfillment contracts and cannot be charged by this subscription endpoint.

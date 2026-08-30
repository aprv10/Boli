# Boli

Boli is an agentic quote-to-order layer for configurable bulk commerce. The buildathon vertical is corporate gifting: a human or AI buyer supplies a bounded mandate, the merchant approves one exact quote hash, Razorpay test checkout is created behind a separate money gate, and every decision is sealed into a hash-linked audit receipt.

## What is implemented

- Natural-language RFQ extraction through one bounded Mistral call, with a manual fallback.
- Deterministic bundle, price, margin, inventory, lead-time, and hard-constraint checks.
- Buyer Deal Room, bounded counteroffers, merchant approval, exact-hash acceptance, and quote history.
- Versioned merchant policy checks and an append-only SHA-256 audit chain.
- Typed AI-buyer discovery and tools, including separately gated checkout creation.
- Razorpay test Orders, Checkout signature verification, raw-body webhook verification, event deduplication, exact amount/currency reconciliation, and idempotent refunds.
- A credential-free local payment mode that signs the same webhook payload processed by the real route.
- The flagship post-payment failure: stock loss, dairy substitute blocked for a vegan mandate, compliant replacement offered, buyer decline, and exactly one full refund.

Money is stored as integer paise. The LLM never prices, approves, accepts, charges, or refunds.

## Run locally

Requirements: Node.js 22.13 or later and pnpm.

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The default `BOLI_PAYMENT_MODE=demo` makes no external payment call and consumes no provider credits.

Mistral is optional. Add `MISTRAL_API_KEY` to `.env.local` to enable the one-call interpreter; structured RFQ entry works without it.

## Automated verification

```powershell
pnpm test
pnpm lint
pnpm build
pnpm demo:smoke
```

`pnpm demo:smoke` expects `pnpm dev` to be running. It resets local demo data, runs the complete purchase/failure/refund journey, replays checkout, webhook, and refund actions, and verifies the final audit chain.

## Razorpay test mode

Set these values in `.env.local` only:

```env
BOLI_PAYMENT_MODE=razorpay
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Configure the Razorpay test webhook URL as `/api/razorpay/webhook` and subscribe to `payment.captured`, `refund.processed`, and `refund.failed`. Boli refuses non-test key IDs. The browser callback is signature-checked and recorded, but only verified webhooks can finalize payment and refund state.

The implementation follows Razorpay's current [Orders API](https://razorpay.com/docs/api/orders/create/), [Standard Checkout verification](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [webhook validation](https://razorpay.com/docs/webhooks/validate-test/), and [idempotent normal refund](https://razorpay.com/docs/api/refunds/normal-refunds-idempotent/) contracts.

## Useful surfaces

- `/` — buyer RFQ desk
- `/merchant/deals` — local merchant inbox
- `/agent` — in-app AI-buyer console
- `/.well-known/boli-commerce` — agent-commerce manifest
- `/api/agent/v1/tools` — typed agent tool endpoint
- `/api/health` — database readiness

The application remains local and in test mode until deployment is explicitly authorized.

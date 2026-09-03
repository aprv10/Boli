# Boli

**Say what you need. Find a deal that fits.**

Boli makes an existing merchant catalog transactable by AI buyers. It normalizes catalog and inventory data, turns natural-language demand into a bounded buyer mandate, builds authoritative quotes, applies merchant policy, and crosses a separate Razorpay payment gate only after buyer approval.

> AI proposes. Policy decides. Razorpay executes.

## What is real

- Server-side Mistral structured extraction for buyer intent and negotiation language.
- Deterministic bundle, price, inventory, delivery, hard-constraint, margin, concession, upsell, reservation, substitution, and refund decisions.
- Exact quote hashes, buyer acceptance, versioned policy checks, and an append-only SHA-256 audit chain.
- Razorpay Test Mode Orders, Checkout signature verification, raw-body webhook verification, event deduplication, exact amount/currency reconciliation, and idempotent refunds.
- A signed local payment provider that passes through the same webhook handler for credential-free demos.
- Post-payment inventory failure, invalid dairy substitute rejection for vegan mandates, compliant replacement acceptance, or one full refund.
- Typed agent-commerce discovery and tools.

Money is stored as integer paise. The model cannot decide prices, discounts, inventory, payment, refund, or transaction state.

## Catalog sources

- Existing local demo merchant and catalog: implemented.
- Buyer requests support welcome kits or one product type from the connected catalog. Products, prices, available stock and lead times are visible at `/catalog`.
- CSV ingestion, Shopify and custom API store connections are not implemented and are not presented as working onboarding options. Boli does not claim universal website scraping.
- Merchant product prices, costs, stock and lead times are editable. Margin and automatic reduction rules are saved as new revisions. Merchant writes are restricted to the same-origin local demo workspace; this is not production authentication.

## Run locally

Requirements: Node.js 22.13 or later and pnpm.

```powershell
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Optional Mistral configuration

Add only this variable to your existing `.env.local` if you want live model interpretation:

```env
MISTRAL_API_KEY=
```

Without it, buyer interpretation opens an empty, editable review form with an explicit notice. There are no demo requirement defaults. Negotiation can interpret an explicit unit price deterministically; neither path authorizes a price on its own.

## Verification

```powershell
pnpm typecheck
pnpm lint
```

End-to-end verification is manual for this iteration. Existing smoke scripts have not been run or updated for the revised buyer experience. Results show up to three distinct eligible options, not three duplicated or invented choices.

## Razorpay Test Mode

The existing project supports these variables:

```env
BOLI_PAYMENT_MODE=razorpay
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Boli refuses non-test key IDs. Configure the webhook route at `/api/razorpay/webhook` for `payment.captured`, `refund.processed`, and `refund.failed`. The browser callback is verified but cannot finalize payment; only a reconciled captured-payment webhook can.

## Product surfaces

- `/` and `/request` — buyer request, editable confirmation, real product options
- `/catalog` — connected products and product-specific request links
- `/sell` and `/merchant/dashboard` — paid sales, paid add-on revenue, attention queue and distinct-request funnel
- `/merchant/deals` — order list with merchant approval and rejection actions
- `/merchant/products` — editable product prices, costs, stock and lead times
- `/merchant/policies` — working margin and automatic reduction rules
- `/transactions` — transaction ledger and Decision Trace entry
- `/deal/:publicToken` — quote, negotiation, upsell, payment, recovery, and verified audit
- `/.well-known/boli-commerce` — agent-commerce manifest
- `/api/agent/v1/tools` — typed agent tools

This repository contains no deployment step. OpenAI Sites and the inherited Sites Vite plugin are not used.

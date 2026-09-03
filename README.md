# Boli — Commerce for the agentic internet

**Say what you need. Find a deal that fits.**

Boli lets merchants make their existing store available to AI buyers. A buyer describes what they need; Boli finds matching offers, helps negotiate within the store’s rules, suggests suitable add-ons, and takes payment through Razorpay only after buyer approval. Welcome kits are one demo example—not the product’s entire purpose.

> AI proposes. Policy decides. Razorpay executes.

## The five-minute demo

Start at `/`: describe the request, check the extracted details, compare up to three eligible offers, and choose **Best Value** (the backend’s recommended option). Request a better price, review the result, optionally add a suitable product, and continue to payment. The existing order controls open in the same buyer workspace; the order URL can be refreshed or revisited.

After payment, use **Demo tools** to simulate an unavailable snack, review the blocked dairy substitute, and accept a valid replacement or request a refund. Open **View Decision Trace**, then **Sell** to see the store-ready state and revenue from actual recorded test orders. See [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the timed recording guide.

The buyer screens keep implementation details out of the way. Hashes, rule versions, and audit verification remain in the advanced Decision Trace receipt.

## What is real

- Server-side Mistral structured extraction for buyer intent and negotiation language, ranking of eligible options, and selection of eligible kit add-ons.
- Deterministic bundle, price, inventory, delivery, hard-constraint, margin, concession, upsell eligibility, reservation, substitution, and refund decisions.
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

Add only this variable to your existing `.env.local` if you want live interpretation, option ranking and add-on recommendations:

```env
MISTRAL_API_KEY=
```

Without it, buyer interpretation opens an empty, editable review form with an explicit notice. There are no demo requirement defaults. Negotiation can interpret an explicit unit price deterministically; neither path authorizes a price on its own.

Ranking and upsells reuse the same server-side key and model. Following [Mistral's structured-output API](https://docs.mistral.ai/studio/conversations/structured-output/custom), the model returns only eligible candidate IDs and references to backend-verified facts. Boli validates every reference and renders the explanation itself: no model-authored prices, eligibility claims or promises. The buyer sees an AI label only for validated Mistral output; missing credentials, invalid output and an 8-second timeout fall back to deterministic recommendations. Only one eligible quote skips the ranking call.

Advisory results are saved in Decision Trace and reused for matching request/candidate snapshots. They do not authorize offers. Upsells remain optional, limited to eligible catalog accessories for kits; mandatory custom requirements disable automatic add-ons. Acceptance binds the exact displayed product and price, rechecks current stock, delivery, costs and margin, then issues a backend quote. No Mistral call occurs during acceptance, checkout, payment or refund execution. There are no additional environment variables for these features.

## Verification

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The unit suite covers quote generation, negotiation, policy checks, payment reconciliation, audit integrity, and bounded AI recommendations. Use the demo script for the browser walkthrough; the older smoke scripts are not the recording guide. Results show up to three distinct eligible options, not duplicated or invented choices. “Best Value” labels the existing recommended choice; its original category and verified explanation remain under “Why this?”.

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

- `/` and `/request` — buyer request, editable details, offers, and the existing order controls via `?order=:publicToken`; negotiation, add-ons, checkout, confirmation and recovery stay in that workspace
- `/catalog` — connected products and product-specific request links
- `/sell` and `/merchant/dashboard` — paid sales, paid add-on revenue, attention queue and distinct-request funnel
- `/merchant/deals` — order list with merchant approval and rejection actions
- `/merchant/products` — editable product prices, costs, stock and lead times
- `/merchant/policies` — working margin and automatic reduction rules
- `/transactions` — transaction ledger and Decision Trace entry
- `/deal/:publicToken` — direct link to the same order, payment, recovery and audit controls (existing links still work)
- `/agent` — existing guided AI-buyer demo, linked from the store overview; uses the shared request form and backend capabilities
- `/.well-known/boli-commerce` — agent-commerce manifest
- `/api/agent/v1/tools` — typed agent tools

This repository contains no deployment step. OpenAI Sites and the inherited Sites Vite plugin are not used.

## Agent flow

The human intent route and agent tools share the purchase-input contract, including product selection, quantity, all-in unit budget, delivery and custom requirements. Agent discovery reports available stock after reservations. `get_deal_options` uses the same eligible options and grounded Mistral ranking as the buyer UI; `select_option` asks the backend to authorize the exact quote under current merchant policy. Ordinary eligible requests no longer require a manual merchant click. Required custom requirements remain blocked until the merchant confirms an offer.

The guided `/agent` flow confirms the mandate, compares options, selects an eligible offer and stops for buyer approval. **Refresh is read-only with respect to acceptance and payment**: it may prepare an offer if none exists, but never accepts one. The explicit approval button submits the displayed quote hash, then the existing order page handles separate checkout. The demo does not call payment tools automatically. Negotiation, add-ons and recovery remain available in that same order page.

Agent tools also expose one bounded negotiation round (product swaps off by default), explicit original/revised proposal choice, eligible add-on recommendation and acceptance of the exact displayed add-on. `accept_quote` and `accept_upsell` require `buyerApproved: true` from the calling buyer, not from recommendation text. `create_checkout` is a separate call using an accepted quote hash and an idempotency key. Status, acceptance, checkout and audit reads do not invoke Mistral. The discovery manifest includes the actual tool-input JSON schema.

The guided console is same-origin and local-only. External tool calls use the existing optional `BOLI_AGENT_API_KEY`; without it, only local requests are allowed and cross-origin browser requests are rejected. This is a local demo integration, not a production buyer identity/delegation system. No new environment variables are required.

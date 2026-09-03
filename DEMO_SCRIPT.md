# Boli — Commerce for the agentic internet

## Five-minute recording guide

Use the main buyer workspace: request → offers → negotiation → upsell → payment → recovery → Decision Trace → merchant dashboard.

### Before recording

- Start locally with `pnpm dev`. Do not reset the database: existing orders and inventory are kept.
- Use the existing Razorpay Test Mode configuration and a working captured-payment webhook. Check for **Demo merchant · Razorpay Test Mode** before recording. Simulated payments are an explicitly labeled fallback, not proof of a Razorpay transaction.
- Use the existing server-side `MISTRAL_API_KEY` for live interpretation and advisory recommendations. No new variables are needed for this cleanup.
- Rehearse with current stock and rules. Narrate displayed prices and add-ons, not invented sample totals. Leave branding out of the sample below: the demo’s plastic-free grow-kit add-on is not brandable.
- Record at a readable browser size. Trim loading time if needed, but do not substitute fabricated results.

### 0:00–0:40 — Buyer request

Start on `/` with the landing section visible.

Say: “Boli makes a merchant’s existing store available to AI buyers. AI proposes. Policy decides. Razorpay executes. Here’s the complete buying journey.”

Enter or select:

> I need welcome kits for 80 employees. ₹900 max per person. Vegan and plastic-free. Hyderabad and Chennai. Within 3 weeks.

Click **Start my request**. Show **Intent understood**, quantity, amount, cities, deadline and requirements. Confirm or correct the details, then click **Find offers**.

Say: “AI turns my words into a request I can review. It doesn’t set prices or approve the purchase.”

### 0:40–1:15 — Offers

Show the eligible offers with actual products, all-in totals, per-kit prices and delivery. Open one **Why this? & price breakdown**, then close it. Choose **Best Value**.

Say: “Every offer has passed product, budget, stock, delivery and merchant-rule checks. AI can rank valid choices; it cannot invent an offer.”

Best Value is the backend’s recommended option, not a hardcoded middle card. It may also be cheapest or fastest; the explanation identifies that category. If current stock allows fewer than three distinct offers, do not claim three are available.

### 1:15–1:55 — Negotiation

Stay in the buyer workspace. Under **Adjust this offer**, use **Enter an amount** or **Write a request**. Ask for roughly 5% below the displayed per-kit price. For example, if it shows ₹700, ask for ₹665—not a fixed ₹850 that might exceed the offer. Leave product swaps off for a simple price-only demo.

Click **Check my target**. Show the proposed price and actual adjustments. Choose **Use revised offer** if available, or **Keep current offer** if the target is rejected or needs store approval. Do not detour to the merchant screen here.

Say: “The store’s rules decide what can be offered. My chat message does not approve a discount or charge me. I explicitly choose the original or revised offer.”

### 1:55–2:20 — Optional upsell

Show the eligible add-on, remaining budget and new total. If offered, add that product to each kit. Note the before-and-after total for the closing dashboard segment. If no add-on qualifies, Boli correctly shows none.

Say: “Boli can grow the order only with something that still fits my requirements, stock, delivery, budget and the merchant’s margin rules. I decide whether to add it.”

Do this before continuing to payment: approving checkout locks the offer version; add-ons are not applied afterward.

### 2:20–3:00 — Approval and payment

Review **Your total** and click **Continue to payment**. Complete the real Razorpay Test Mode checkout yourself. Wait for **Payment confirmed** and the confirmation heading.

Say: “I approve these items and this total. The server creates the payment order from the saved offer. Boli confirms payment only after verifying the captured-payment webhook.”

If the callback arrives before the webhook, show the pending message or trim the wait. Never describe a pending payment as confirmed. No real funds or fulfillment are involved in Test Mode.

### 3:00–3:45 — Failure and recovery

Open **Demo tools** and simulate an unavailable snack. Show the update: the dairy substitute is blocked because vegan is required, while a compliant replacement is offered. Choose **Accept valid replacement** for the main recording and show the accepted state with no extra charge.

Say: “The stock failure is simulated. The checks and saved recovery decision are real. An incompatible substitute is rejected, and the buyer chooses a valid replacement or full refund.”

Alternative ending: request a refund and show its actual pending or processed state. Do not claim the same order still contributes paid revenue afterward; refunded and refund-pending orders are excluded from paid dashboard metrics.

### 3:45–4:20 — Decision Trace

Open **View Decision Trace** below the order. Follow the recorded request, offer, negotiation, add-on, approval, payment and recovery events. Briefly expand the technical receipt to show verification; do not read hashes aloud.

Say: “These are stored decisions for this order, not a scripted timeline. The integrity check verifies the saved event chain.”

Only show events that occurred. Replacement and refund are alternative outcomes. Verification checks stored records; it is not external proof that records were never removed.

### 4:20–5:00 — Merchant dashboard and close

Click **Sell**. Show **Your store is now available to AI buyers.** Its product count and rules come from the connected demo store—not an arbitrary website import.

Show paid sales, add-on revenue, paid orders, AOV lift and recent decisions. Relate added revenue to the amount actually accepted and paid. Metrics aggregate recorded test orders; do not present them as production traction or attribute the entire aggregate to this one order.

Close: “Merchants keep their catalog and rules. Buyers get a clear path from intent to payment, with recovery when something goes wrong. Boli—commerce for the agentic internet.”

## Honest fallbacks

- Mistral unavailable: use the editable request form and disclose that interpretation is not live. Recommendations can fall back to deterministic choices; do not call those live AI responses.
- Razorpay unavailable: the existing simulated-payment provider exercises local payment and recovery handling but does not contact Razorpay. Do not present that recording as Razorpay Test Mode.
- CSV ingestion, Shopify/custom API connections, universal website scraping and live fulfillment are not implemented or part of this demonstration.

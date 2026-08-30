# Five-minute Boli demo

1. Reset the inbox with `pnpm demo:reset` and open `/`.
2. Enter: “Buy 80 vegan, plastic-free, branded welcome kits below ₹900 each, split between Hyderabad and Chennai, needed in three weeks.” Use Mistral if configured, then confirm the extracted locks.
3. In `/merchant/deals`, open the deal, compare deterministic options, and approve **Best value**. Point out the budget, margin, stock, lead-time, and hard-constraint checks.
4. In the buyer Deal Room, try a safe counteroffer, then accept the exact quote. Show that the quote fingerprint binds merchant approval and buyer acceptance.
5. Create checkout. In demo mode, choose **Simulate verified test payment**. Explain that the browser cannot mark the deal paid; the signed webhook must match order, amount, and currency.
6. Return to the merchant deal and trigger **stock-loss recovery**. Boli blocks the dairy cookie substitute because vegan is locked, then offers a compliant replacement at no extra charge.
7. In the Deal Room, decline the replacement. Boli issues one full refund. Click again or run `pnpm demo:smoke` to show that replay cannot create a second refund.
8. Finish on the audit receipt: the chain should be verified and end in `refund_processed`.

Fallback: if Mistral or Razorpay is unavailable, use structured RFQ entry and the signed local payment mode. The deterministic commerce, policy, webhook, failure, refund, and audit paths remain identical.

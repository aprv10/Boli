import type { StoredQuote, StoredQuoteEvent } from '@/src/application/quote-workflow';
const labels: Record<string, string> = {
  request_received: 'Buyer request saved', quote_approved: 'Offer authorized', counteroffer_submitted: 'Target price requested',
  counteroffer_evaluated: 'Store rules checked', counteroffer_approved: 'Store approved the proposal', counteroffer_rejected: 'Store declined the proposal',
  counteroffer_selected: 'Buyer chose revised offer', counteroffer_kept_original: 'Buyer kept original offer', quote_accepted: 'Buyer approved checkout',
  checkout_order_created: 'Payment order created', payment_captured: 'Payment verified', quote_expired: 'Offer expired',
  fulfilment_substitution_blocked: 'Invalid substitute rejected', compliant_replacement_offered: 'Replacement offered',
  compliant_replacement_accepted: 'Replacement accepted', replacement_declined: 'Buyer requested refund',
  refund_processed: 'Refund processed', constraint_safe_upsell_accepted: 'Add-on selected',
  custom_quote_requested: 'Store review requested', custom_quote_responded: 'Store responded',
  inventory_failure_reported: 'Inventory failure simulated',
  options_ranked: 'Options ranked', upsell_recommended: 'Add-on recommendation checked',
};
export function DecisionTrace({ events, verified, headHash, quote }: { events: StoredQuoteEvent[]; verified: boolean; headHash: string; quote?: StoredQuote }) {
  return <details className="decision-trace" id="decision-trace"><summary>View Decision Trace <span>{verified ? 'Recorded chain verified' : 'Integrity warning'}</span></summary>
    <p>Actual saved events, in order. Comparing offers does not imply buyer approval or payment.</p>
    <ol>{[...events].sort((a, b) => a.sequence - b.sequence).map(event => <li key={event.id}><div><strong>{labels[event.eventType] ?? event.eventType.replaceAll('_', ' ')}</strong><time>{new Date(event.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {event.actorType}</time></div><p>{event.summary}</p></li>)}</ol>
    <details><summary>Technical receipt & verification</summary><p>The saved sequence, links and event hashes {verified ? 'match' : 'did not all match'}. This checks the records currently stored; it is not an externally anchored proof of completeness.</p>{quote ? <><p>Quote {quote.version} · Rules {quote.policyVersion} · Margin {(quote.contributionMarginBps / 100).toFixed(2)}%</p><p>Quote fingerprint</p><code>{quote.quoteHash}</code><ul>{quote.checks.map((check, index) => <li key={index}>{check.passed ? '✓' : '–'} {check.code}: {check.observed} (required: {check.required})</li>)}</ul></> : null}<p>Audit head</p><code>{headHash || 'No events yet'}</code></details>
  </details>;
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type NegotiationOutcome = {
  status: string; targetUnitPaise: number; proposedUnitPaise: number | null;
  sourceUnitPaise: number; message: string; summary: string;
  changes: Array<{ label: string; before: number; after: number }>;
};
type Props = { publicToken: string; quoteHash: string; disabled: boolean; outcome: NegotiationOutcome | null };
const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);

export function CounterofferPanel({ publicToken, quoteHash, disabled, outcome }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setSubmitting(true); setError('');
    try {
      const response = await fetch(`/api/public/deals/${publicToken}/counteroffers`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedQuoteHash: quoteHash, buyerMessage: message }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'Your request could not be evaluated.');
      setSent(true); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Please try again.'); router.refresh(); }
    finally { setSubmitting(false); }
  }
  if (outcome) {
    const pending = outcome.status === 'merchant_approval_required';
    const rejected = outcome.status === 'rejected' || outcome.status === 'closed';
    return <section className="order-negotiation negotiation-outcome" aria-live="polite">
      <div className="shopping-section-heading"><h2>{pending ? 'Waiting for the merchant' : rejected ? 'Current offer kept' : 'Your negotiation result'}</h2><span className="status-pill">{pending ? 'Approval requested' : 'Reviewed'}</span></div>
      <blockquote>“{outcome.message}”</blockquote>
      <p>{outcome.summary}</p>
      <dl className="negotiation-prices"><div><dt>Your target / unit</dt><dd>{money(outcome.targetUnitPaise)}</dd></div><div><dt>{pending ? 'Proposed' : rejected ? 'Current' : 'New'} price / unit</dt><dd>{money(outcome.proposedUnitPaise ?? outcome.sourceUnitPaise)}</dd></div></dl>
      {outcome.changes.length ? <details open><summary>{pending ? 'Proposed changes' : 'What changed'}</summary><div className="actual-changes">{outcome.changes.map(change => <div key={change.label}><span>{change.label}</span><span>{money(change.before)} → <strong>{money(change.after)}</strong></span></div>)}</div></details> : null}
      <small>One price request per order. {pending ? 'Refresh after the merchant reviews it, or continue with your current offer.' : 'Continuing to payment accepts the exact items and total shown in your order.'}</small>
      {pending ? <button className="subtle-button" type="button" onClick={() => router.refresh()}>Refresh status</button> : null}
    </section>;
  }
  return <details className="order-negotiation" id="negotiate">
    <summary>Want a better price?</summary>
    <p>Ask once for a lower price. Boli checks discounts and item alternatives against the store’s rules.</p>
    <label htmlFor="negotiation-message">Your target price</label>
    <div className="negotiation-prompt"><textarea id="negotiation-message" placeholder="Can you do ₹850 per kit?" value={message} onChange={event => setMessage(event.target.value)} maxLength={280} disabled={disabled || submitting || sent} /><button type="button" onClick={submit} disabled={disabled || submitting || sent || message.trim().length < 3}>{submitting ? 'Checking your request…' : sent ? 'Request saved' : 'Ask for a better price'}</button></div>
    {error ? <p className="shopping-notice" role="alert">{error}</p> : null}
  </details>;
}

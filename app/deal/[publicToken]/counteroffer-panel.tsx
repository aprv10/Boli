'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export type NegotiationOutcome = {
  id: string; buyerChoice: 'pending' | 'original' | 'revised' | null;
  status: string; targetUnitPaise: number; proposedUnitPaise: number | null;
  sourceUnitPaise: number; message: string; summary: string;
  changes: Array<{ label: string; before: number; after: number }>;
};
type Props = { publicToken: string; quoteHash: string; disabled: boolean; outcome: NegotiationOutcome | null; currentUnitPaise: number; quantity: number; unit: string };
const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);

export function CounterofferPanel({ publicToken, quoteHash, disabled, outcome, currentUnitPaise, quantity, unit }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'amount' | 'message'>('amount');
  const [alternatives, setAlternatives] = useState(false);
  const [busy, setBusy] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  async function request(path: string, payload: object) {
    const response = await fetch('/api/public/deals/' + publicToken + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message ?? 'We could not save your request.');
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy('proposal'); setError('');
    try {
      const target = Math.round(Number(amount) * 100);
      if (mode === 'amount' && (!Number.isSafeInteger(target) || target < 100 || target >= currentUnitPaise)) throw new Error('Enter a target below the current price per ' + unit + '.');
      await request('/counteroffers', { expectedQuoteHash: quoteHash, awaitBuyerChoice: true, allowAlternatives: alternatives,
        buyerMessage: mode === 'message' ? message : 'Can you do ' + money(target) + ' per ' + unit + '?',
        ...(mode === 'amount' ? { targetUnitPaise: target } : {}) });
      setSent(true); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Try again.'); router.refresh(); }
    finally { setBusy(''); }
  }
  async function choose(choice: 'original' | 'revised') {
    if (!outcome) return;
    setBusy(choice); setError('');
    try { await request('/counteroffers/choose', { counterofferId: outcome.id, expectedQuoteHash: quoteHash, choice }); router.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Try again.'); router.refresh(); }
    finally { setBusy(''); }
  }
  if (outcome) {
    const pending = outcome.status === 'merchant_approval_required';
    const closed = outcome.status === 'rejected' || outcome.status === 'closed' || outcome.buyerChoice === 'original';
    const selectable = outcome.buyerChoice === 'pending' && !closed && !disabled;
    const revised = outcome.proposedUnitPaise ?? outcome.sourceUnitPaise;
    const selected = outcome.buyerChoice === 'revised' || (!outcome.buyerChoice && !pending && !closed);
    return <section className="order-negotiation negotiation-outcome" aria-live="polite">
      <div className="shopping-section-heading"><div><h2>{outcome.status === 'closed' ? 'This price request is closed' : closed ? 'Your current offer is kept' : pending ? 'The store is reviewing your target' : selected ? 'Revised offer selected' : 'A lower offer to consider'}</h2><p>{closed ? 'No changes were made by this price request. The order summary shows the current offer.' : pending ? 'Your current offer stays available while you wait.' : selected ? 'This is your saved negotiation result. The order summary includes any later changes and payment status.' : 'Compare the changes below. Your order has not changed yet.'}</p></div></div>
      <blockquote>“{outcome.message}”</blockquote><p>{outcome.summary}</p>
      {!closed ? <div className="offer-comparison"><div><span>{selected ? 'Previous offer' : 'Current offer'}</span><strong>{money(outcome.sourceUnitPaise)}<small> / {unit}</small></strong><p>{money(outcome.sourceUnitPaise * quantity)} total</p></div><div><span>{pending ? 'Pending approval' : selected ? 'Selected offer' : 'Proposed offer'}</span><strong>{money(revised)}<small> / {unit}</small></strong><p>{money(revised * quantity)} total</p></div></div> : null}
      {!closed ? <p className="negotiation-saving">{money((outcome.sourceUnitPaise - revised) * quantity)} less for the order · {revised <= outcome.targetUnitPaise ? 'Your target is met' : money(revised - outcome.targetUnitPaise) + ' / ' + unit + ' above your target'}</p> : null}
      {!closed && outcome.changes.length ? <div className="actual-changes" aria-label="Item and price changes">{outcome.changes.map(change => <div key={change.label}><span>{change.label}</span><span>{money(change.before)} → <strong>{money(change.after)}</strong> / {unit}</span></div>)}</div> : null}
      {selectable ? <div className="offer-choice-actions">{!pending ? <button type="button" disabled={Boolean(busy)} onClick={() => choose('revised')}>{busy === 'revised' ? 'Updating order…' : 'Use revised offer'}</button> : <button className="subtle-button" type="button" disabled={Boolean(busy)} onClick={() => router.refresh()}>Check for a response</button>}<button className="subtle-button" type="button" disabled={Boolean(busy)} onClick={() => choose('original')}>{busy === 'original' ? 'Saving…' : 'Keep current offer'}</button></div> : null}
      <small>{selectable ? 'Choosing an offer updates the order only. It never charges you.' : 'One price request per order. Payment is always a separate approval.'}</small>
      {error ? <p className="flow-error" role="alert">{error}</p> : null}
    </section>;
  }
  return <section className="order-negotiation" id="negotiate">
    <div className="shopping-section-heading"><div><h2>Adjust this offer</h2><p>Have a target in mind? Let’s see what the store can offer.</p></div><span>Optional</span></div>
    <form onSubmit={submit} className="negotiation-form">
      <div className="budget-choice" role="group" aria-label="How to enter a target"><button type="button" disabled={disabled || Boolean(busy) || sent} aria-pressed={mode === 'amount'} onClick={() => setMode('amount')}>Enter an amount</button><button type="button" disabled={disabled || Boolean(busy) || sent} aria-pressed={mode === 'message'} onClick={() => setMode('message')}>Write a request</button></div>
      {mode === 'amount' ? <label>Your target per {unit}<div className="amount-input"><span aria-hidden="true">₹</span><input type="number" required min="1" max={(currentUnitPaise - 1) / 100} step=".01" placeholder="Your amount" value={amount} onChange={event => setAmount(event.target.value)} disabled={disabled || Boolean(busy) || sent} /></div><small>Current price: {money(currentUnitPaise)} per {unit}, including services.</small></label> : <label>Your target price<textarea required minLength={3} maxLength={280} value={message} onChange={event => setMessage(event.target.value)} placeholder={'Can you get this below ₹' + Math.floor(currentUnitPaise / 100 * .95) + ' per ' + unit + '?'} disabled={disabled || Boolean(busy) || sent} /><small>Ask for one price per {unit}. Delivery, quantity and requirements stay unchanged.</small></label>}
      <label className="requirement-confirm"><input type="checkbox" checked={alternatives} onChange={event => setAlternatives(event.target.checked)} disabled={disabled || Boolean(busy) || sent} /><span>Also consider different products that meet my requirements.<small>Leave this off to keep the exact same items.</small></span></label>
      <footer><small>One negotiation round. You’ll review any proposed changes first.</small><button disabled={disabled || Boolean(busy) || sent}>{busy ? 'Checking prices & store rules…' : sent ? 'Request saved' : 'Check my target'}</button></footer>
    </form>
    {error ? <p className="flow-error" role="alert">{error}</p> : null}
  </section>;
}

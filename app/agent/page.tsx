'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { RfqInterpretation } from '@/src/application/agent/rfq-contract';
import type { GuidedBuyerRun } from '@/src/application/agent/guided-buyer';
import { RequestReviewForm } from '../request/request-review-form';
import { draftFromInterpretation, emptyDraft, purchaseInputFromDraft, type Draft } from '../request/request-draft';

const initialBrief = '30 welcome kits, ₹900 per kit, vegan, delivered to Chennai within 3 weeks.';
const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);

export default function AgentBuyerPage() {
  const [brief, setBrief] = useState(initialBrief);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [interpretationId, setInterpretationId] = useState('');
  const [source, setSource] = useState('');
  const [run, setRun] = useState<GuidedBuyerRun | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function readRequest(event: FormEvent) {
    event.preventDefault();
    setBusy('Reading your request…'); setError(''); setInterpretationId(''); setRun(null);
    try {
      const response = await fetch('/api/agent/interpret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief }) });
      const result = await response.json() as { runId?: string; interpretation?: RfqInterpretation; error?: { message?: string } };
      if (!response.ok || !result.interpretation || !result.runId) throw new Error(result.error?.message ?? 'Could not interpret this request. Enter the details manually.');
      setDraft(draftFromInterpretation(result.interpretation));
      setInterpretationId(result.runId);
      setSource(result.interpretation.clarifyingQuestion || 'Mistral drafted these details. Review and correct them before the agent continues.');
    } catch (caught) {
      setDraft(emptyDraft()); setSource('Manual request · nothing has been assumed.');
      setError(caught instanceof Error ? caught.message : 'Enter your requirements below.');
    } finally { setBusy(''); }
  }

  function loadExample() {
    const date = new Date(); date.setUTCDate(date.getUTCDate() + 21);
    const deadline = date.toISOString().slice(0, 10);
    // Update text and fields together. Never attach fixed demo values to an edited brief.
    setBrief(`30 welcome kits, ₹900 per kit, vegan, delivered to Chennai by ${deadline}.`);
    setDraft({ ...emptyDraft(), mode: 'kit', quantity: '30', budget: '900', locations: 'Chennai', deadline, constraints: ['vegan'] });
    setInterpretationId(''); setRun(null); setError('');
    setSource('Ready-made request · no AI interpretation call. The same live catalog and rules will be checked.');
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const input = purchaseInputFromDraft(brief, draft, interpretationId);
    if (!input.success) { setError(input.error.issues[0]?.message ?? 'Check your request details.'); return; }
    await dispatch({ mode: 'start', mandate: input.data });
  }

  async function dispatch(input: Record<string, unknown>) {
    setBusy(input.mode === 'start' ? 'Comparing options and checking store rules…' : input.mode === 'accept' ? 'Checking your approval…' : 'Refreshing the result…');
    setError('');
    try {
      const response = await fetch('/api/agent/v1/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      const result = await response.json() as GuidedBuyerRun & { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'Could not confirm the action. Refresh the current result before retrying.');
      setRun(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not continue.'); }
    finally { setBusy(''); }
  }

  const quote = run?.quote;
  const canApprove = run?.stage === 'ready_to_accept' && quote;
  const merchantReview = run && ['awaiting_merchant_approval', 'requirements_need_changes', 'request_declined'].includes(run.stage);
  return <main className="new-shell merchant-workspace">
    <header className="merchant-heading"><div><p className="eyebrow">AI buyer demo</p><h1>A request. A policy-checked offer.</h1><p>Let Boli choose from eligible options. You still approve the exact order before checkout.</p></div><Link className="subtle-button" href="/sell">Back to store →</Link></header>
    {!run ? <section className="merchant-content">
      <div className="shopping-section-heading"><h2>{draft ? 'Review the buying request' : 'What should the agent find?'}</h2></div>
      {!draft ? <>
        <form className="shopping-composer" onSubmit={readRequest}>
          <label htmlFor="agent-brief">Describe the order</label>
          <textarea id="agent-brief" value={brief} minLength={3} maxLength={600} required disabled={Boolean(busy)} onChange={event => { setBrief(event.target.value); setError(''); }} />
          <div><button type="button" className="subtle-button" disabled={Boolean(busy)} onClick={loadExample}>Use an example</button><button disabled={Boolean(busy)}>{busy || 'Read my request with AI →'}</button></div>
        </form>
        <button type="button" className="subtle-button" disabled={Boolean(busy)} onClick={() => { setDraft(emptyDraft()); setSource('Manual request · enter and confirm the details.'); setInterpretationId(''); setError(''); }}>Enter details manually</button>
      </> : <>
        <p className="shopping-notice">{source}</p>
        <details className="request-receipt"><summary>Original request</summary><p>{brief}</p><button type="button" className="subtle-button" disabled={Boolean(busy)} onClick={() => { setDraft(null); setInterpretationId(''); }}>Edit original request</button></details>
        <RequestReviewForm draft={draft} onChange={setDraft} onSubmit={start} busy={busy}
          submitLabel="Confirm request & let Boli choose" submitHint="The agent will select an eligible option and ask the backend for a quote. Nothing is purchased." />
      </>}
    </section> : <>
      <div className="order-layout">
        <section className="merchant-content">
          <div className="shopping-section-heading"><h2>What happened</h2><span>Actual backend results</span></div>
          <div className="merchant-decisions" aria-live="polite">{run.steps.map((step, index) => <div key={`${step.tool}:${index}`}>
            <p><strong>{step.status === 'completed' ? '✓' : step.status === 'blocked' ? '—' : '→'} {step.title}</strong></p><p>{step.summary}</p>
          </div>)}</div>
          <p className="shopping-notice">{run.instruction}</p>
          {run.customRequest?.merchantResponse ? <div className="request-receipt"><strong>Store response</strong><p>{run.customRequest.merchantResponse}</p></div> : null}
          <div className="shopping-section-heading">
            <button type="button" className="subtle-button" disabled={Boolean(busy)} onClick={() => dispatch({ mode: 'resume', dealId: run.deal.id })}>{busy || 'Refresh result'}</button>
            {merchantReview ? <Link href={`/merchant/deals/${run.deal.id}`} target="_blank" rel="noreferrer">Open store review ↗</Link> : null}
          </div>
        </section>
        <aside className="order-summary">
          <h2>{quote ? 'Your exact offer' : 'Your request'}</h2>
          <p>{run.deal.mandate.quantity} {run.deal.mandate.selection.mode === 'kit' ? 'kits' : 'items'} · {run.deal.mandate.deliveryLocations.join(', ')}</p>
          {quote ? <>
            <ul>{quote.lines.filter(line => line.kind === 'product').map(line => <li key={line.code}>{line.label}</li>)}</ul>
            <dl><div><dt>Per {run.deal.mandate.selection.mode === 'kit' ? 'kit' : 'item'}</dt><dd>{money(quote.unitTotalPaise)}</dd></div><div className="summary-total"><dt>Total</dt><dd>{money(quote.orderTotalPaise)}</dd></div></dl>
            {canApprove ? <button type="button" className="subtle-button" disabled={Boolean(busy)} onClick={() => dispatch({ mode: 'accept', dealId: run.deal.id, expectedQuoteHash: quote.quoteHash, buyerApproved: true })}>Approve this exact offer</button> : null}
            <p><Link href={run.deal.dealRoomPath}>{canApprove ? 'Review, negotiate or add an item →' : run.stage === 'accepted' ? 'Continue to checkout →' : 'Open your order →'}</Link></p>
          </> : <p><Link href={run.deal.dealRoomPath}>View request details →</Link></p>}
          <small>Payments use the existing checkout and server verification. Preparing an offer does not charge you.</small>
        </aside>
      </div>
      <details className="request-receipt"><summary>Decision receipt & agent tools</summary><p>{run.audit.verified ? 'Recorded audit chain verified.' : 'Audit integrity warning.'} <Link href={`${run.deal.dealRoomPath}#decision-trace`}>View full Decision Trace →</Link></p><p><Link href="/.well-known/boli-commerce" target="_blank">View the tool contract ↗</Link></p></details>
      <button type="button" className="subtle-button" disabled={Boolean(busy)} onClick={() => { setRun(null); setError(''); }}>Start another request</button>
    </>}
    {error ? <p className="flow-error" role="alert">{error}</p> : null}
  </main>;
}

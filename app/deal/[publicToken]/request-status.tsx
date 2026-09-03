'use client';
import { useRouter } from 'next/navigation';
import type { CustomQuoteRequest } from '@/src/application/custom-quote-workflow';
import { saveDraft, type Draft } from '../../request/request-draft';

export function RequestStatus({ request, draft, brief, hasQuote }: { request: CustomQuoteRequest; draft: Draft; brief: string; hasQuote: boolean }) {
  const router = useRouter();
  const titles = { pending: 'Your request is with the store', quoted: 'The store sent an offer', needs_changes: 'The store needs a change', declined: 'The store can’t fulfil this request' };
  function revise() {
    if (saveDraft({ brief, draft, runId: '' })) router.push('/request?draft=1');
    else router.push('/request');
  }
  return <section className="order-items request-status" aria-live="polite"><div className="shopping-section-heading"><div><h2>{titles[request.status]}</h2><p>{request.status === 'pending' ? 'The Good Batch will check your requirements and respond here. Asking for a review does not charge you or change an existing order.' : hasQuote ? 'The store’s response is below. Check the order summary for the current items, total and payment status.' : 'No payable offer has been issued. You can revise your request below.'}</p></div><span className="status-pill">{request.status === 'pending' ? 'Awaiting response' : 'Store response'}</span></div>
    {request.merchantResponse ? <blockquote>{request.merchantResponse}</blockquote> : null}
    <dl className="request-status-facts"><div><dt>Buying</dt><dd>{draft.quantity} × {draft.mode === 'kit' ? 'welcome kits' : draft.query}</dd></div><div><dt>Budget / unit</dt><dd>₹{Number(draft.budget).toLocaleString('en-IN')}</dd></div><div><dt>Delivery</dt><dd>{draft.locations} · by {draft.deadline}</dd></div></dl>
    {draft.custom.length ? <ul className="requirement-list">{draft.custom.map((item, index) => <li key={index}><div><strong>{item.text}</strong><span>{item.priority === 'preferred' ? 'Preference · see store response for inclusion' : request.status === 'quoted' ? 'Confirmed by the store for this offer' : 'Required · not confirmed'}</span></div></li>)}</ul> : null}
    <div className="offer-choice-actions">{request.status === 'pending' ? <button className="subtle-button" type="button" onClick={() => router.refresh()}>Check for a response</button> : !hasQuote ? <button type="button" onClick={revise}>Revise this request</button> : null}</div>
  </section>;
}

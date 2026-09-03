import Link from 'next/link';
import { notFound } from 'next/navigation';
import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { loadDealCounteroffers } from '@/src/application/counteroffer-workflow';
import { loadDealQuotes, loadDealQuoteWorkspace } from '@/src/application/quote-workflow';
import { loadDealPaymentState } from '@/src/application/payment-workflow';
import { ApproveCounterofferButton } from './approve-counteroffer-button';
import { RejectCounterofferButton } from './reject-counteroffer-button';
import { loadCustomQuoteRequest } from '@/src/application/custom-quote-workflow';
import { CustomQuotePanel } from './custom-quote-panel';
const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
export const metadata = { title: 'Order details — Boli' };
export default async function MerchantDealPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  await ensureDatabase(env.DB);
  const workspace = await loadDealQuoteWorkspace(env.DB, dealId);
  if (!workspace) notFound();
  const { deal } = workspace;
  const customRequest = await loadCustomQuoteRequest(env.DB, dealId);
  const [quotes, counteroffers, payment] = await Promise.all([loadDealQuotes(env.DB, dealId), loadDealCounteroffers(env.DB, dealId), loadDealPaymentState(env.DB, dealId)]);
  const quote = quotes.find(item => item.status === 'buyer_accepted' || item.status === 'merchant_approved');
  const pending = counteroffers.filter(item => item.status === 'merchant_approval_required' && item.buyerChoice !== 'original' && item.sourceQuoteId === quote?.id && quote.status === 'merchant_approved' && Date.parse(quote.expiresAt) > Date.parse(workspace.evaluatedAt));
  return <main className="new-shell merchant-workspace">
    <header className="merchant-heading"><div><Link href="/merchant/deals">← All orders</Link><h1>Order #{deal.id.slice(0, 8).toUpperCase()}</h1><p>{payment.stage === 'not_ready' ? quote ? 'Awaiting buyer decision' : 'Request received' : payment.stage.replaceAll('_', ' ')}</p></div><Link className="subtle-button" href={`/deal/${deal.publicToken}`}>Buyer order & decision trace ↗</Link></header>
    {customRequest?.status === 'pending' ? <CustomQuotePanel dealId={dealId} note={customRequest.buyerNote} requirements={deal.customRequirements} options={workspace.result.status === 'generated' ? workspace.result.options : []} /> : customRequest ? <section className="merchant-content"><h2>Your response</h2><p>{customRequest.merchantResponse}</p><small>{customRequest.status === 'quoted' ? 'Offer sent to buyer' : customRequest.status === 'needs_changes' ? 'Buyer asked to revise request' : 'Request declined'}</small></section> : null}
    {pending.map(offer => <section className="merchant-content approval-request" key={offer.id}><div className="shopping-section-heading"><h2>Price reduction needs your approval</h2><span className="status-pill status-attention">Action needed</span></div><blockquote>“{offer.buyerMessage}”</blockquote><div className="approval-numbers"><div><span>Current / unit</span><strong>{money(quote!.unitTotalPaise)}</strong></div><div><span>Proposed / unit</span><strong>{money(offer.proposedOption!.unitTotalPaise)}</strong></div><div><span>Margin after reduction</span><strong>{(offer.proposedOption!.contributionMarginBps / 100).toFixed(2)}%</strong></div><div><span>Proposed order total</span><strong>{money(offer.proposedOption!.orderTotalPaise)}</strong></div></div>
      <p>The price reduction exceeds your automatic limit of {(workspace.policy.maximumAutomaticConcessionBps / 100).toFixed(1)}%. Approval still requires your minimum margin of {(workspace.policy.minimumMarginBps / 100).toFixed(1)}%.</p>
      <details><summary>Review proposed items and charges</summary><table className="merchant-table"><thead><tr><th>Item / charge</th><th>Price / unit</th><th>Cost / unit</th></tr></thead><tbody>{offer.proposedOption!.lines.map(line => <tr key={line.code}><td>{line.label}</td><td>{money(line.unitPricePaise)}</td><td>{money(line.unitCostPaise)}</td></tr>)}</tbody></table></details>
      <div className="merchant-actions"><ApproveCounterofferButton dealId={deal.id} counterofferId={offer.id} /><RejectCounterofferButton dealId={deal.id} counterofferId={offer.id} /></div><small>Approval sends a revised offer. It does not charge the buyer.</small></section>)}
    <section className="merchant-content"><h2>Buyer requirements</h2>{deal.customRequirements.length ? <ul className="requirement-list">{deal.customRequirements.map((item, index) => <li key={index}><strong>{item.text}</strong><span>{item.priority}</span></li>)}</ul> : null}<p>{deal.rawText}</p><dl className="merchant-facts"><div><dt>Quantity</dt><dd>{deal.quantity}</dd></div><div><dt>Budget / unit</dt><dd>{money(deal.maxUnitPaise)}</dd></div><div><dt>Delivery</dt><dd>{deal.deliveryLocations.join(', ')}</dd></div><div><dt>Deadline</dt><dd>{deal.deadline}</dd></div></dl>{deal.hardConstraints.length ? <div className="constraint-tags">{deal.hardConstraints.map(constraint => <span key={constraint}>{constraint.replaceAll('-', ' ')}</span>)}</div> : null}</section>
    <section className="merchant-content"><div className="shopping-section-heading"><h2>{quote ? 'Current order' : 'No quote selected'}</h2>{quote ? <span>{money(quote.orderTotalPaise)} · {(quote.contributionMarginBps / 100).toFixed(2)}% margin</span> : null}</div>{quote ? <div className="merchant-table-wrap"><table className="merchant-table"><thead><tr><th>Item / charge</th><th>Price / unit</th><th>Cost / unit</th><th>Total × {quote.quantity}</th></tr></thead><tbody>{quote.lines.map(line => <tr key={line.code}><td><strong>{line.label}</strong><small>{line.code}</small></td><td>{money(line.unitPricePaise)}</td><td>{money(line.unitCostPaise)}</td><td>{money(line.unitPricePaise * quote.quantity)}</td></tr>)}</tbody></table></div> : <p>The buyer has not selected an offer. Their request is saved above.</p>}</section>
    {payment.incident ? <section className="merchant-content"><h2>Fulfillment update</h2><p>{payment.incident.explanation}</p><p>{payment.stage.replaceAll('_', ' ')} · {payment.incident.replacement.compliantReplacement}</p><Link href={`/deal/${deal.publicToken}`}>View buyer’s recovery options →</Link></section> : null}
    {counteroffers.length ? <section className="merchant-content"><h2>Price requests</h2>{counteroffers.map(offer => <div className="merchant-history-row" key={offer.id}><strong>{money(offer.targetUnitPaise)} target / unit</strong><span>{offer.status.replaceAll('_', ' ')}</span><p>{offer.decisionSummary}</p></div>)}</section> : null}
  </main>;
}

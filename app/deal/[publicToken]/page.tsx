import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { loadDealCounteroffers } from '@/src/application/counteroffer-workflow';
import { loadPublicDealRoom } from '@/src/application/quote-workflow';
import { loadPublicPaymentState } from '@/src/application/payment-workflow';
import { CounterofferPanel, type NegotiationOutcome } from './counteroffer-panel';
import { CheckoutPanel } from './checkout-panel';
import { findSafeUpsell } from '@/src/application/upsell-workflow';
import { UpsellCard } from './upsell-card';
import { FulfilmentFailureButton } from '../../merchant/deals/[dealId]/fulfilment-failure-button';
import { requiresMerchantReview } from '@/src/domain/quoting/custom-requirements';
import { loadCustomQuoteRequest } from '@/src/application/custom-quote-workflow';
import { RequestStatus } from './request-status';
import { DecisionTrace } from './decision-trace';
import { loadAuditLedgerNewestFirst } from '@/src/application/audit-ledger';

type Props = { params: Promise<{ publicToken: string }> };
const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
const moment = (value: string) => new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const metadata: Metadata = { title: 'Your order — Boli', description: 'Review your items, request a better price and pay securely.', openGraph: { images: [] }, twitter: { images: [] } };

export default async function DealRoomPage({ params }: Props) {
  const { publicToken } = await params;
  await ensureDatabase(env.DB);
  const room = await loadPublicDealRoom(env.DB, publicToken);
  const payment = await loadPublicPaymentState(env.DB, publicToken);
  if (!room || !payment) notFound();
  const history = await loadDealCounteroffers(env.DB, room.deal.id);
  const customRequest = await loadCustomQuoteRequest(env.DB, room.deal.id);
  const customLocked = requiresMerchantReview(room.deal.customRequirements);
  const quote = room.currentQuote;
  const accepted = quote?.status === 'buyer_accepted';
  const expired = Boolean(quote && Date.parse(quote.expiresAt) <= Date.parse(room.evaluatedAt));
  const products = quote?.lines.filter(line => line.kind === 'product') ?? [];
  const unit = room.deal.selection?.mode === 'product' ? 'item' : 'kit';
  const latest = history[0];
  const pendingPriceDecision = latest?.buyerChoice === 'pending' || (latest?.status === 'merchant_approval_required' && latest?.buyerChoice !== 'original');
  const suggestedUpsell = quote && !accepted && !expired && !pendingPriceDecision
    ? await findSafeUpsell(env.DB, publicToken, room.evaluatedAt, env.MISTRAL_API_KEY ?? process.env.MISTRAL_API_KEY) : null;
  const upsell = suggestedUpsell?.sourceQuoteHash === quote?.quoteHash ? suggestedUpsell : null;
  // Include any advisory event just recorded, not the pre-recommendation ledger.
  const trace = suggestedUpsell ? await loadAuditLedgerNewestFirst(env.DB, room.deal.id)
    : { events: room.events, verified: room.auditVerified, headHash: room.auditHeadHash };
  let outcome: NegotiationOutcome | null = null;
  if (latest) {
    const source = room.quoteHistory.find(item => item.id === latest.sourceQuoteId);
    const before = source?.lines ?? [];
    const stale = (latest.status === 'merchant_approval_required' || latest.buyerChoice === 'pending') && (accepted || quote?.id !== latest.sourceQuoteId);
    const after = latest.status === 'rejected' || stale ? before : latest.proposedOption?.lines ?? before;
    const codes = [...new Set([...before, ...after].map(line => line.code))];
    outcome = {
      id: latest.id, buyerChoice: latest.buyerChoice,
      status: stale ? 'closed' : latest.status, targetUnitPaise: latest.targetUnitPaise, proposedUnitPaise: latest.status === 'rejected' || stale ? null : latest.proposedOption?.unitTotalPaise ?? null,
      sourceUnitPaise: source?.unitTotalPaise ?? quote?.unitTotalPaise ?? 0, message: latest.buyerMessage, summary: stale ? 'This price request is closed because you accepted or changed the offer. The order total shown here is the one that applies.' : latest.buyerChoice === 'original' && latest.status !== 'rejected' ? 'You kept the original offer. The proposed changes were not applied.' : latest.decisionSummary,
      changes: codes.map(code => ({ label: after.find(line => line.code === code)?.label ?? before.find(line => line.code === code)!.label, before: before.find(line => line.code === code)?.unitPricePaise ?? 0, after: after.find(line => line.code === code)?.unitPricePaise ?? 0 })).filter(change => change.before !== change.after),
    };
  }
  const hasSnack = products.some(line => room.catalog.find(product => product.id === line.productId)?.category === 'snack');
  const leadDays = Math.max(0, ...(quote?.checks.filter(check => ['LEAD_TIME_FEASIBLE', 'UPSELL_DELIVERY_FEASIBLE'].includes(check.code)).map(check => Number(check.observed.replace('d', ''))) ?? []));
  return <main className="new-shell order-shell">
    <div className="order-breadcrumb"><Link href="/request">← New request</Link><span>The Good Batch · Order {room.deal.id.slice(0, 8).toUpperCase()}</span></div>
    <header className="order-heading"><div><p className="eyebrow">Your order</p><h1>{payment.stage === 'refunded' ? 'Refund complete.' : accepted ? 'Your items. All in one place.' : 'A closer look at your deal.'}</h1></div><span className="status-pill">{payment.stage === 'paid' ? 'Paid' : payment.stage === 'refunded' ? 'Refunded' : accepted ? 'Accepted' : expired ? 'Offer expired' : !quote ? 'Request saved' : 'Ready to review'}</span></header>
    {customRequest ? <RequestStatus request={customRequest} brief={room.deal.rawText} hasQuote={Boolean(quote)} draft={{
      quantity: String(room.deal.quantity), budget: String(room.deal.maxUnitPaise / 100), budgetKind: 'per_unit',
      locations: room.deal.deliveryLocations.join(', '), deadline: room.deal.deadline, mode: room.deal.selection?.mode ?? 'kit',
      query: room.deal.selection?.query ?? '', constraints: room.deal.hardConstraints, custom: room.deal.customRequirements,
    }} /> : null}
    {!quote ? customRequest ? null : <section className="shopping-empty"><h2>No offer selected yet</h2><p>Start a new request to see items available from the store.</p><Link href="/request">Find products →</Link></section> :
    <div className="order-layout">
      <div className="order-main">
        <section className="order-items">
          <div className="shopping-section-heading"><h2>{unit === 'kit' ? 'Inside each kit' : 'Your items'}</h2><span>{quote.quantity} {unit}s</span></div>
          <div className="order-line-labels"><span>Product</span><span>Per {unit}</span><span>Line total</span></div>
          {products.map(line => <div className="order-product-row" key={line.code}><div><strong>{line.label}</strong><small>{line.code} · {quote.quantity} units</small></div><span>{money(line.unitPricePaise)}</span><strong>{money(line.unitPricePaise * quote.quantity)}</strong></div>)}
          <div className="order-delivery"><div><span>Deliver to</span><strong>{room.deal.deliveryLocations.join(' · ')}</strong></div><div><span>Requested by</span><strong>{new Date(room.deal.deadline + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}</strong></div><div><span>Catalog lead time</span><strong>{leadDays} days</strong></div></div>
          {room.deal.hardConstraints.length ? <div className="constraint-tags">{room.deal.hardConstraints.map(constraint => <span key={constraint}>✓ {constraint.replaceAll('-', ' ')}</span>)}</div> : null}
          {!customRequest && room.deal.customRequirements.length ? <div className="request-receipt"><strong>Preferences · not guaranteed</strong><ul>{room.deal.customRequirements.map((item, index) => <li key={index}>{item.text}</li>)}</ul></div> : null}
          <details className="request-receipt"><summary>Your original request</summary><p>{room.deal.rawText}</p><p>Budget: {money(room.deal.maxUnitPaise)} / {unit}</p></details>
        </section>
        {!customLocked && (!accepted || outcome) ? <CounterofferPanel publicToken={publicToken} quoteHash={quote.quoteHash} currentUnitPaise={quote.unitTotalPaise} quantity={quote.quantity} unit={unit} disabled={expired || accepted} outcome={outcome} /> : null}
        {customLocked && !accepted ? <p className="shopping-notice">The store confirmed your specific requirements for these exact items and total. Automatic product changes and add-ons are disabled for this offer.</p> : null}
        {!accepted && !expired && upsell && !pendingPriceDecision ? <UpsellCard publicToken={publicToken} quoteHash={quote.quoteHash} suggestion={upsell} /> : null}
        <DecisionTrace events={trace.events} verified={trace.verified} headHash={trace.headHash} quote={quote} />
        {!customLocked && accepted && payment.stage === 'paid' && room.deal.hardConstraints.includes('vegan') && hasSnack ? <details className="failure-demo-card"><summary>Demo tools</summary><h3>Simulate an unavailable snack</h3><p>This changes the paid order’s fulfillment state. Boli will reject a dairy substitute and look for a vegan replacement.</p><FulfilmentFailureButton dealId={room.deal.id} disabled={false} /></details> : null}
      </div>
      <aside className="order-summary">
        <h2>Order summary</h2>
        <dl><div><dt>Products × {quote.quantity}</dt><dd>{money(products.reduce((sum, line) => sum + line.unitPricePaise, 0) * quote.quantity)}</dd></div>{quote.lines.filter(line => line.kind === 'service').map(line => <div key={line.code}><dt>{line.label}</dt><dd>{money(line.unitPricePaise * quote.quantity)}</dd></div>)}<div className="summary-total"><dt>Total</dt><dd>{money(quote.orderTotalPaise)}</dd></div><div><dt>Per {unit}</dt><dd>{money(quote.unitTotalPaise)}</dd></div></dl>
        {expired && !accepted ? <p className="shopping-notice">This offer has expired. <Link href="/request">Start a new request</Link> for current pricing.</p> : <CheckoutPanel key={quote.quoteHash} publicToken={publicToken} quoteHash={quote.quoteHash} amountPaise={quote.orderTotalPaise} accepted={accepted} disabled={expired && !accepted} payment={{ stage: payment.stage, order: payment.order, providerPaymentId: payment.payment?.providerPaymentId ?? null, refund: payment.refund, incident: payment.incident }} />}
        {!accepted ? <p className="offer-validity">Offer valid until {moment(quote.expiresAt)}.</p> : null}
      </aside>
    </div>}
    {!quote ? <DecisionTrace events={room.events} verified={room.auditVerified} headHash={room.auditHeadHash} /> : null}
  </main>;
}

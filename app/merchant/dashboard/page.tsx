import Link from 'next/link';
import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { DEMO_MERCHANT } from '@/src/adapters/db/seed-data';
import { loadMerchantMetrics, loadMerchantOrders } from '@/src/application/merchant-overview';
import { OrderTable } from '../order-table';
import { DemoModeLabel } from '../../demo-mode-label';
const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);

export default async function MerchantDashboardPage() {
  await ensureDatabase(env.DB);
  const [metrics, orders, catalog, recent] = await Promise.all([
    loadMerchantMetrics(env.DB), loadMerchantOrders(env.DB),
    env.DB.prepare(`SELECT COUNT(*) AS count, EXISTS (
      SELECT 1 FROM merchants m JOIN merchant_policy_versions p ON p.merchant_id=m.id
      WHERE m.id=? AND m.status='active' AND p.status='active'
    ) AS rulesReady FROM products WHERE merchant_id=? AND active=1`).bind(DEMO_MERCHANT.id, DEMO_MERCHANT.id).first<{ count: number; rulesReady: number }>(),
    env.DB.prepare(`SELECT e.id, e.deal_id AS dealId, e.summary, e.event_type AS eventType, e.created_at AS createdAt
      FROM quote_events e JOIN deals d ON d.id=e.deal_id WHERE d.merchant_id=? AND e.event_type IN
      ('custom_quote_responded','counteroffer_selected','counteroffer_kept_original','counteroffer_evaluated','counteroffer_approved','counteroffer_rejected','payment_captured','constraint_safe_upsell_accepted','fulfilment_substitution_blocked','refund_processed')
      ORDER BY e.created_at DESC, e.sequence DESC LIMIT 5`).bind(DEMO_MERCHANT.id).all<{ id: string; dealId: string; summary: string; eventType: string; createdAt: string }>(),
  ]);
  const pending = orders.filter(order => order.pending || order.customStatus === 'pending');
  const recovery = orders.filter(order => order.incidentStatus && !order.replacementAccepted && order.paymentStatus !== 'refunded');
  const funnel = [{ label: 'Requests', value: metrics.intents }, { label: 'Quoted', value: metrics.quotes }, { label: 'Paid', value: metrics.purchases }];
  return <main className="new-shell merchant-workspace">
    <header className="merchant-heading"><div><p className="eyebrow">The Good Batch</p><h1>Store overview</h1><p>Your orders, revenue and decisions in one place.</p></div><Link className="subtle-button" href="/merchant/products">{catalog?.count ?? 0} products connected →</Link></header>
    <p className="merchant-context-note"><DemoModeLabel /> · Test orders, not production sales</p>
    {catalog && catalog.count > 0 && catalog.rulesReady ? <section className="store-ready" aria-label="Store readiness"><div><span className="eyebrow">Store ready ✓</span><h2>Your store is now available to AI buyers.</h2><p>{catalog.count} products available · Inventory mapped · Merchant rules configured</p></div><Link className="subtle-button" href="/request">Try the buyer experience →</Link></section> : <p className="shopping-notice">Add active products and configure your merchant rules to make offers available to AI buyers.</p>}
    <p className="merchant-context-note"><Link href="/agent">Try the AI buyer demo →</Link> · See how a buyer’s agent uses your catalog and rules.</p>
    <section className="merchant-content"><div className="shopping-section-heading"><div><h2>Needs attention</h2><p>{pending.length} requests to review · {recovery.length} orders in recovery</p></div><Link href="/merchant/deals">All orders →</Link></div>{pending.length || recovery.length ? <OrderTable orders={[...new Map([...pending, ...recovery].map(order => [order.id, order])).values()]} /> : <div className="merchant-clear"><span>✓</span><div><strong>You’re all caught up</strong><p>Requests that need your decision will appear here.</p></div></div>}</section>
    <section className="merchant-metrics"><article><span>Paid sales</span><strong>{money(metrics.sales)}</strong><small>Refunded and pending orders excluded</small></article><article><span>Revenue from add-ons</span><strong>{money(metrics.incremental)}</strong><small>Paid add-ons, after proportional discounts</small></article><article><span>Paid orders</span><strong>{metrics.purchases}</strong><small>Paid, non-refunded orders</small></article><article><span>AOV lift from add-ons</span><strong>{metrics.lift.toFixed(1)}%</strong><small>Against the same orders without add-ons</small></article></section>
    <div className="merchant-overview-grid"><section className="merchant-content"><div className="shopping-section-heading"><h2>From request to purchase</h2><span>Unique requests</span></div><div className="merchant-funnel">{funnel.map(item => <div key={item.label}><div><span>{item.label}</span><strong>{item.value}</strong></div><span className="funnel-track"><i style={{ width: `${metrics.intents ? item.value / metrics.intents * 100 : 0}%` }} /></span></div>)}</div><p className="merchant-funnel-optional"><strong>{metrics.negotiations}</strong> requests included negotiation. Negotiation is optional, not a required checkout step.</p><small>Each request is counted once. Paid sales exclude refunds.</small></section>
    <section className="merchant-content"><div className="shopping-section-heading"><h2>Recent decisions</h2></div><div className="merchant-decisions">{recent.results.length ? recent.results.map(event => <Link key={event.id} href={`/merchant/deals/${event.dealId}`}><p>{event.summary}</p><small>{new Date(event.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · View order →</small></Link>) : <p>Decisions will appear as buyers place requests.</p>}</div></section></div>
    <section className="merchant-content"><div className="shopping-section-heading"><h2>Recent orders</h2><Link href="/merchant/deals">View all →</Link></div><OrderTable orders={orders.slice(0, 5)} /></section>
  </main>;
}

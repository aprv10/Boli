import { DEMO_MERCHANT } from '@/src/adapters/db/seed-data';
import type { QuoteLine } from '@/src/domain/quoting/types';

export type MerchantOrderRow = {
  id: string; publicToken: string; request: string; quantity: number; createdAt: string;
  amountPaise: number | null; quoteStatus: string | null; paymentStatus: string | null;
  incidentStatus: string | null; replacementAccepted: string | null; pending: number;
  customStatus: string | null;
};
export function merchantOrderStatus(row: MerchantOrderRow) {
  if (row.paymentStatus === 'refunded') return 'Refunded';
  if (row.paymentStatus === 'refund_pending') return 'Refund pending';
  if (row.replacementAccepted) return 'Replacement accepted';
  if (row.incidentStatus === 'replacement_offered') return 'Awaiting replacement decision';
  if (row.paymentStatus === 'paid') return 'Paid';
  if (row.customStatus === 'pending') return 'Custom request';
  if (row.pending) return 'Approval needed';
  if (row.quoteStatus === 'buyer_accepted') return 'Awaiting payment';
  if (row.quoteStatus) return 'Offer sent';
  if (row.customStatus === 'needs_changes') return 'Buyer revision requested';
  if (row.customStatus === 'declined') return 'Request declined';
  return 'New request';
}
export async function loadMerchantOrders(db: D1Database) {
  const rows = await db.prepare(`SELECT d.id, d.public_token AS publicToken, i.raw_text AS request,
    r.quantity, d.created_at AS createdAt, q.order_total_paise AS amountPaise, q.status AS quoteStatus,
    o.status AS paymentStatus, f.status AS incidentStatus, f.accepted_at AS replacementAccepted, cr.status AS customStatus,
    (SELECT COUNT(*) FROM counteroffers c WHERE c.deal_id=d.id AND c.status='merchant_approval_required'
      AND c.source_quote_id=q.id AND q.status='merchant_approved' AND q.expires_at>?
      AND (c.buyer_choice IS NULL OR c.buyer_choice='pending')) AS pending
    FROM deals d JOIN purchase_intents i ON i.id=d.intent_id JOIN purchase_requirements r ON r.intent_id=i.id
    LEFT JOIN quotes q ON q.id=(SELECT id FROM quotes WHERE deal_id=d.id ORDER BY version DESC LIMIT 1)
    LEFT JOIN razorpay_orders o ON o.id=(SELECT id FROM razorpay_orders WHERE deal_id=d.id ORDER BY created_at DESC LIMIT 1)
    LEFT JOIN fulfilment_incidents f ON f.deal_id=d.id
    LEFT JOIN custom_quote_requests cr ON cr.deal_id=d.id
    WHERE d.merchant_id=? ORDER BY d.created_at DESC`).bind(new Date().toISOString(), DEMO_MERCHANT.id).all<MerchantOrderRow>();
  return rows.results;
}

export async function loadMerchantMetrics(db: D1Database) {
  const [paid, events, counts] = await Promise.all([
    db.prepare(`SELECT o.deal_id AS dealId, o.amount_paise AS amount, q.lines_json AS linesJson, q.quantity
      FROM razorpay_orders o JOIN deals d ON d.id=o.deal_id JOIN quotes q ON q.id=o.quote_id
      WHERE d.merchant_id=? AND o.status='paid'
      AND EXISTS (SELECT 1 FROM razorpay_payments p WHERE p.order_id=o.id AND p.status='captured')
      AND NOT EXISTS (SELECT 1 FROM refunds r JOIN razorpay_payments p ON p.id=r.payment_id WHERE p.order_id=o.id AND r.status IN ('pending','processed','reconciliation_required'))`)
      .bind(DEMO_MERCHANT.id).all<{ dealId: string; amount: number; linesJson: string; quantity: number }>(),
    db.prepare(`SELECT e.deal_id AS dealId, e.data_json AS dataJson FROM quote_events e JOIN deals d ON d.id=e.deal_id
      WHERE d.merchant_id=? AND e.event_type='constraint_safe_upsell_accepted'`).bind(DEMO_MERCHANT.id).all<{ dealId: string; dataJson: string }>(),
    db.prepare(`SELECT COUNT(*) AS intents,
      SUM(EXISTS(SELECT 1 FROM quotes q WHERE q.deal_id=d.id)) AS quotes,
      SUM(EXISTS(SELECT 1 FROM counteroffers c WHERE c.deal_id=d.id)) AS negotiations
      FROM deals d WHERE merchant_id=?`).bind(DEMO_MERCHANT.id).first<{ intents: number; quotes: number; negotiations: number }>(),
  ]);
  let incremental = 0;
  for (const order of paid.results) {
    const lines = JSON.parse(order.linesJson) as QuoteLine[];
    const addedIds = new Set(events.results.filter(event => event.dealId === order.dealId).map(event => (JSON.parse(event.dataJson) as { productId?: string }).productId));
    const beforeDiscounts = lines.reduce((sum, line) => sum + Math.max(0, line.unitPricePaise), 0) * order.quantity;
    const share = beforeDiscounts ? Math.min(1, order.amount / beforeDiscounts) : 0;
    incremental += Math.round(lines.filter(line => line.kind === 'product' && addedIds.has(line.productId)).reduce((sum, line) => sum + line.unitPricePaise * order.quantity, 0) * share);
  }
  const sales = paid.results.reduce((sum, row) => sum + row.amount, 0);
  return { sales, incremental, purchases: new Set(paid.results.map(row => row.dealId)).size,
    lift: sales > incremental ? incremental / (sales - incremental) * 100 : 0,
    intents: counts?.intents ?? 0, quotes: counts?.quotes ?? 0, negotiations: counts?.negotiations ?? 0 };
}

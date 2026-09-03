import { prepareAuditBatch } from './audit-ledger';
import { loadPublicDealRoom, QuoteWorkflowError } from './quote-workflow';

export type CustomQuoteRequest = {
  status: 'pending' | 'quoted' | 'needs_changes' | 'declined';
  buyerNote: string; merchantResponse: string | null; createdAt: string; respondedAt: string | null;
};
export function loadCustomQuoteRequest(db: D1Database, dealId: string) {
  return db.prepare(`SELECT status, buyer_note AS buyerNote, merchant_response AS merchantResponse,
    created_at AS createdAt, responded_at AS respondedAt FROM custom_quote_requests WHERE deal_id=?`)
    .bind(dealId).first<CustomQuoteRequest>();
}

export async function requestCustomQuote(db: D1Database, token: string, note: string, now = new Date().toISOString()) {
  const room = await loadPublicDealRoom(db, token);
  if (!room) throw new QuoteWorkflowError('NOT_FOUND', 'This request was not found.', 404);
  const existing = await loadCustomQuoteRequest(db, room.deal.id);
  if (existing) return existing;
  if (room.quoteHistory.some(quote => quote.status === 'buyer_accepted')) throw new QuoteWorkflowError('ORDER_ACCEPTED', 'This order has already been accepted. Start a new request for other requirements.', 409);
  const audit = await prepareAuditBatch(db, room.deal.id, [{ id: crypto.randomUUID(), quoteId: null,
    eventType: 'custom_quote_requested', actorType: 'buyer', summary: 'Buyer asked the store to review this request.', data: { note }, createdAt: now }]);
  try {
    await db.batch([
      db.prepare(`INSERT INTO custom_quote_requests (deal_id,status,buyer_note,created_at)
        VALUES ((SELECT id FROM deals WHERE id=? AND NOT EXISTS (SELECT 1 FROM quotes WHERE deal_id=? AND status='buyer_accepted')),'pending',?,?)`)
        .bind(room.deal.id, room.deal.id, note, now),
      ...audit.statements,
    ]);
  } catch (error) {
    if (/constraint|unique/i.test(String(error))) throw new QuoteWorkflowError('REQUEST_CHANGED', 'The request changed. Refresh to see its status.', 409);
    throw error;
  }
  return loadCustomQuoteRequest(db, room.deal.id);
}

export async function respondToCustomQuote(db: D1Database, dealId: string, status: 'needs_changes' | 'declined', message: string, now = new Date().toISOString()) {
  const deal = await db.prepare('SELECT merchant_id AS merchantId FROM deals WHERE id=?').bind(dealId).first<{merchantId: string}>();
  if (!deal) throw new QuoteWorkflowError('NOT_FOUND', 'This request was not found.', 404);
  const audit = await prepareAuditBatch(db, dealId, [{ id: crypto.randomUUID(), quoteId: null,
    eventType: 'custom_quote_responded', actorType: 'merchant', summary: message, data: { status }, createdAt: now }]);
  try {
    await db.batch([
      // A zero-row update alone would not abort a D1 batch. This NOT NULL guard does.
      db.prepare(`INSERT INTO merchant_changes (id,merchant_id,kind,before_json,after_json,created_at)
        VALUES (?,?,'custom_quote',(SELECT json_object('status',status) FROM custom_quote_requests WHERE deal_id=? AND status='pending'),?,?)`)
        .bind(crypto.randomUUID(), deal.merchantId, dealId, JSON.stringify({ status, message }), now),
      db.prepare("UPDATE custom_quote_requests SET status=?,merchant_response=?,responded_at=? WHERE deal_id=? AND status='pending'").bind(status, message, now, dealId),
      ...audit.statements,
    ]);
  } catch (error) {
    if (/constraint|unique/i.test(String(error))) throw new QuoteWorkflowError('REQUEST_CHANGED', 'This request has already been reviewed. Refresh for the latest response.', 409);
    throw error;
  }
  return loadCustomQuoteRequest(db, dealId);
}

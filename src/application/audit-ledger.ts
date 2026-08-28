import { asc, eq } from 'drizzle-orm';
import { quoteEvents } from '@/db/schema';
import { getDatabase } from '@/src/adapters/db/database';
import {
  AUDIT_GENESIS_HASH,
  createAuditChain,
  verifyAuditChain,
  type AuditEventDraft,
  type HashedAuditEvent,
} from '@/src/domain/audit/audit-chain';

export type StoredAuditLedger = {
  events: HashedAuditEvent[];
  verified: boolean;
  headHash: string;
};

export async function prepareAuditBatch(
  binding: D1Database,
  dealId: string,
  drafts: AuditEventDraft[],
) {
  const head = await binding
    .prepare(
      `SELECT sequence, event_hash AS eventHash
       FROM quote_events WHERE deal_id = ? ORDER BY sequence DESC LIMIT 1`,
    )
    .bind(dealId)
    .first<{ sequence: number; eventHash: string }>();
  const startingSequence = (head?.sequence ?? 0) + 1;
  const startingHash = head?.eventHash || AUDIT_GENESIS_HASH;
  const events = await createAuditChain(
    dealId,
    startingSequence,
    startingHash,
    drafts,
  );
  const statements = events.map((event) =>
    binding
      .prepare(
        `INSERT INTO quote_events (
          id, deal_id, quote_id, sequence, event_type, actor_type,
          summary, data_json, previous_hash, event_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.dealId,
        event.quoteId,
        event.sequence,
        event.eventType,
        event.actorType,
        event.summary,
        JSON.stringify(event.data),
        event.previousHash,
        event.eventHash,
        event.createdAt,
      ),
  );
  return { events, statements };
}

export async function loadAuditLedger(
  binding: D1Database,
  dealId: string,
): Promise<StoredAuditLedger> {
  const rows = await getDatabase(binding)
    .select()
    .from(quoteEvents)
    .where(eq(quoteEvents.dealId, dealId))
    .orderBy(asc(quoteEvents.sequence));
  const events: HashedAuditEvent[] = rows.map((row) => ({
    id: row.id,
    dealId: row.dealId,
    quoteId: row.quoteId,
    sequence: row.sequence,
    eventType: row.eventType,
    actorType: row.actorType,
    summary: row.summary,
    data: JSON.parse(row.dataJson) as Record<string, unknown>,
    previousHash: row.previousHash,
    eventHash: row.eventHash,
    createdAt: row.createdAt,
  }));
  return {
    events,
    verified: events.length > 0 && (await verifyAuditChain(events)),
    headHash: events.at(-1)?.eventHash ?? AUDIT_GENESIS_HASH,
  };
}

export async function loadAuditLedgerNewestFirst(
  binding: D1Database,
  dealId: string,
) {
  const ledger = await loadAuditLedger(binding, dealId);
  return { ...ledger, events: [...ledger.events].sort((a, b) => b.sequence - a.sequence) };
}

import { sha256Hex } from '../quoting/executable-quote';

export const AUDIT_GENESIS_HASH = '0'.repeat(64);

export type AuditEventDraft = {
  id: string;
  quoteId: string | null;
  eventType: string;
  actorType: 'buyer' | 'merchant' | 'system';
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
};

export type HashedAuditEvent = AuditEventDraft & {
  dealId: string;
  sequence: number;
  previousHash: string;
  eventHash: string;
};

async function hashAuditEvent(
  event: Omit<HashedAuditEvent, 'eventHash'>,
) {
  return sha256Hex({ schema: 'boli.audit-event.v1', ...event });
}

export async function createAuditChain(
  dealId: string,
  startingSequence: number,
  startingHash: string,
  drafts: AuditEventDraft[],
) {
  const events: HashedAuditEvent[] = [];
  let previousHash = startingHash;

  for (const [index, draft] of drafts.entries()) {
    const eventWithoutHash = {
      ...draft,
      dealId,
      sequence: startingSequence + index,
      previousHash,
    };
    const eventHash = await hashAuditEvent(eventWithoutHash);
    const event = { ...eventWithoutHash, eventHash };
    events.push(event);
    previousHash = eventHash;
  }

  return events;
}

export async function verifyAuditChain(events: HashedAuditEvent[]) {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  let previousHash = AUDIT_GENESIS_HASH;

  for (const [index, event] of ordered.entries()) {
    if (event.sequence !== index + 1 || event.previousHash !== previousHash) {
      return false;
    }
    const { eventHash, ...eventWithoutHash } = event;
    if ((await hashAuditEvent(eventWithoutHash)) !== eventHash) return false;
    previousHash = eventHash;
  }
  return true;
}

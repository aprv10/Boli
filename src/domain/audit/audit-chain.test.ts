import { describe, expect, it } from 'vitest';
import {
  AUDIT_GENESIS_HASH,
  createAuditChain,
  verifyAuditChain,
} from './audit-chain';

describe('audit chain', () => {
  it('links every event to the exact previous event hash', async () => {
    const events = await createAuditChain('deal-1', 1, AUDIT_GENESIS_HASH, [
      {
        id: 'event-1',
        quoteId: null,
        eventType: 'request_received',
        actorType: 'buyer',
        summary: 'Buyer submitted a mandate.',
        data: { maxUnitPaise: 90_000 },
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'event-2',
        quoteId: 'quote-1',
        eventType: 'quote_approved',
        actorType: 'merchant',
        summary: 'Merchant approved quote v1.',
        data: { policyVersion: 1 },
        createdAt: '2026-09-01T00:01:00.000Z',
      },
    ]);

    expect(events[1].previousHash).toBe(events[0].eventHash);
    await expect(verifyAuditChain(events)).resolves.toBe(true);
  });

  it('detects a changed historical fact', async () => {
    const [event] = await createAuditChain('deal-1', 1, AUDIT_GENESIS_HASH, [
      {
        id: 'event-1',
        quoteId: null,
        eventType: 'request_received',
        actorType: 'buyer',
        summary: 'Buyer submitted a mandate.',
        data: { maxUnitPaise: 90_000 },
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);

    await expect(
      verifyAuditChain([
        { ...event, data: { maxUnitPaise: 95_000 } },
      ]),
    ).resolves.toBe(false);
  });
});

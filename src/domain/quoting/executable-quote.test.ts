import { describe, expect, it } from 'vitest';
import { SEED_PRODUCTS } from '@/src/adapters/db/seed-data';
import { generateCorporateGiftingQuotes } from './corporate-gifting-engine';
import { createQuoteFingerprints, stableStringify } from './executable-quote';
import type { CatalogProduct, QuoteOption } from './types';

const catalog: CatalogProduct[] = SEED_PRODUCTS.map((product) => ({ ...product }));
const result = generateCorporateGiftingQuotes(catalog, {
  quantity: 120,
  maxUnitPaise: 90_000,
  deliveryLocations: ['Bengaluru', 'Pune'],
  deadline: '2026-09-04',
  hardConstraints: ['vegan', 'plastic-free', 'branded', 'multi-city'],
  now: '2026-08-25T00:00:00.000Z',
});

if (result.status !== 'generated') throw new Error('Seed quote fixture is not feasible.');

function fingerprint(option: QuoteOption, version = 1) {
  return createQuoteFingerprints({
    dealId: 'deal-test',
    intentId: 'intent-test',
    version,
    quantity: 120,
    maxUnitPaise: 90_000,
    deliveryLocations: ['Bengaluru', 'Pune'],
    deadline: '2026-09-04',
    hardConstraints: ['vegan', 'plastic-free', 'branded', 'multi-city'],
    policyVersion: 1,
    option,
    expiresAt: '2026-08-27T00:00:00.000Z',
  });
}

describe('executable quote fingerprints', () => {
  it('canonicalizes object keys before hashing', () => {
    expect(stableStringify({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}',
    );
  });

  it('produces the same fingerprint for the same executable terms', async () => {
    await expect(fingerprint(result.options[0])).resolves.toEqual(
      await fingerprint(result.options[0]),
    );
  });

  it('changes the quote fingerprint when the approved version changes', async () => {
    const first = await fingerprint(result.options[0], 1);
    const second = await fingerprint(result.options[0], 2);
    expect(first.intentHash).toBe(second.intentHash);
    expect(first.quoteHash).not.toBe(second.quoteHash);
  });

  it('changes the fingerprint when financial terms change', async () => {
    const first = await fingerprint(result.options[0]);
    const second = await fingerprint({
      ...result.options[0],
      unitTotalPaise: result.options[0].unitTotalPaise - 100,
      orderTotalPaise: result.options[0].orderTotalPaise - 12_000,
    });
    expect(first.quoteHash).not.toBe(second.quoteHash);
  });
});

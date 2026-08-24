import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SEED_PRODUCTS } from '@/src/adapters/db/seed-data';
import { generateCorporateGiftingQuotes } from './corporate-gifting-engine';
import type { CatalogProduct, QuoteRequest } from './types';

const catalog: CatalogProduct[] = SEED_PRODUCTS.map((product) => ({ ...product }));

const request: QuoteRequest = {
  quantity: 120,
  maxUnitPaise: 90_000,
  deliveryLocations: ['Bengaluru', 'Pune'],
  deadline: '2026-08-28',
  hardConstraints: ['vegan', 'plastic-free', 'branded', 'multi-city'],
  now: '2026-08-25T00:00:00.000Z',
};

describe('generateCorporateGiftingQuotes', () => {
  it('returns explainable options inside the buyer and merchant boundaries', () => {
    const result = generateCorporateGiftingQuotes(catalog, request);

    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.options).toHaveLength(3);
    for (const option of result.options) {
      expect(option.unitTotalPaise).toBeLessThanOrEqual(request.maxUnitPaise);
      expect(option.contributionMarginBps).toBeGreaterThanOrEqual(2_200);
      expect(option.orderTotalPaise).toBe(option.unitTotalPaise * request.quantity);
      expect(option.checks.every((check) => check.passed)).toBe(true);
    }
  });

  it('never includes a non-vegan product when vegan is locked', () => {
    const result = generateCorporateGiftingQuotes(catalog, request);

    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const productNames = result.options.flatMap((option) =>
      option.lines.filter((line) => line.kind === 'product').map((line) => line.label),
    );
    expect(productNames).not.toContain('Butter Shortbread Box');
  });

  it('rejects an impossible budget instead of relaxing constraints', () => {
    const result = generateCorporateGiftingQuotes(catalog, {
      ...request,
      maxUnitPaise: 30_000,
    });

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.reasons[0].code).toBe('NO_POLICY_SAFE_COMBINATION');
  });

  it('rejects unavailable inventory explicitly', () => {
    const result = generateCorporateGiftingQuotes(
      catalog.map((product) => ({ ...product, availableQuantity: 0 })),
      request,
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.reasons.every((reason) => reason.code === 'NO_ELIGIBLE_PRODUCT_FOR_SLOT')).toBe(true);
  });

  it('is deterministic for identical inputs', () => {
    expect(generateCorporateGiftingQuotes(catalog, request)).toEqual(
      generateCorporateGiftingQuotes(catalog, request),
    );
  });

  it('preserves the budget invariant across generated quantities and caps', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 200 }),
        fc.integer({ min: 700, max: 1_500 }),
        (quantity, maxRupees) => {
          const generated = generateCorporateGiftingQuotes(catalog, {
            ...request,
            quantity,
            maxUnitPaise: maxRupees * 100,
            deadline: '2026-08-30',
          });
          if (generated.status === 'generated') {
            return generated.options.every(
              (option) => option.unitTotalPaise <= maxRupees * 100,
            );
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

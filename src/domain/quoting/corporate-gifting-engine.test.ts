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

describe('distinct shopping options', () => {
  const bottleRequest: QuoteRequest = {
    selection: { mode: 'product', query: 'steel bottles' },
    quantity: 50,
    maxUnitPaise: 40_000,
    deliveryLocations: ['Hyderabad'],
    deadline: '2026-09-24',
    hardConstraints: [],
    now: '2026-09-03T00:00:00.000Z',
  };

  const signature = (option: { lines: { kind: string; productId?: string }[] }) =>
    option.lines.filter(line => line.kind === 'product').map(line => line.productId).sort().join(':');
  const days = (option: { checks: { code: string; observed: string }[] }) =>
    Number(option.checks.find(check => check.code === 'LEAD_TIME_FEASIBLE')?.observed.replace('d', ''));

  function sampleBottle(id: string, price: number, lead: number): CatalogProduct {
    return { id, sku: id, name: `${id} Steel Bottle`, category: 'drinkware', tags: ['vegan', 'plastic-free'], unitPricePaise: price, unitCostPaise: Math.floor(price * .6), availableQuantity: 500, leadTimeDays: lead };
  }

  it('offers three different stocked bottles for the homepage demo request', () => {
    const result = generateCorporateGiftingQuotes(catalog, bottleRequest);
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.options).toHaveLength(3);
    expect(new Set(result.options.map(signature)).size).toBe(3);
    expect(result.options.map(days)).toEqual([5, 3, 1]);
    expect(result.options.map(option => option.unitTotalPaise)).toEqual([24_174, 30_906, 38_454]);
    expect(result.options.filter(option => option.recommended)).toHaveLength(1);
    expect(result.options.every(option => option.unitTotalPaise <= bottleRequest.maxUnitPaise
      && option.contributionMarginBps >= 2_200 && option.checks.every(check => check.passed))).toBe(true);
  });

  it.each([
    { quantity: 30, cities: ['Chennai'], constraints: ['vegan'] as const },
    { quantity: 80, cities: ['Hyderabad', 'Chennai'], constraints: ['vegan', 'plastic-free', 'multi-city'] as const },
  ])('offers three different configurations for the $quantity-kit demo', ({ quantity, cities, constraints }) => {
    const result = generateCorporateGiftingQuotes(catalog, {
      ...bottleRequest, selection: { mode: 'kit', query: '' }, quantity,
      maxUnitPaise: 90_000, deliveryLocations: cities, hardConstraints: [...constraints],
    });
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.options).toHaveLength(3);
    expect(new Set(result.options.map(signature)).size).toBe(3);
    expect(result.options.every(option => option.unitTotalPaise <= 90_000 && option.checks.every(check => check.passed))).toBe(true);
  });

  it('fills the remaining slots even when cheapest also wins the other rankings', () => {
    const products = [sampleBottle('a', 10_000, 1), sampleBottle('b', 12_000, 2), sampleBottle('c', 15_000, 3)];
    const result = generateCorporateGiftingQuotes(products, bottleRequest);
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.options).toHaveLength(3);
    expect(new Set(result.options.map(signature)).size).toBe(3);
    expect(result.options[0]).toMatchObject({ label: 'Cheapest', recommended: true });
    expect(result.options.some(option => option.label === 'Fastest')).toBe(false);
    expect(result.options[2].label).toBe('Another option');
  });

  it('preserves the genuinely fastest card when it also wins the value score', () => {
    const products = [sampleBottle('a', 10_000, 5), sampleBottle('b', 13_000, 3), sampleBottle('c', 15_000, 1)];
    const result = generateCorporateGiftingQuotes(products, bottleRequest);
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.options).toHaveLength(3);
    expect(result.options.find(option => option.label === 'Fastest')).toMatchObject({ recommended: true });
    expect(signature(result.options.find(option => option.label === 'Fastest')!)).toBe('c');
  });

  it('returns more than one option when every product has the same delivery time', () => {
    const result = generateCorporateGiftingQuotes(
      [sampleBottle('a', 10_000, 3), sampleBottle('b', 12_000, 3), sampleBottle('c', 15_000, 3)], bottleRequest,
    );
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.options).toHaveLength(3);
    expect(result.options.filter(option => option.recommended)).toHaveLength(1);
    expect(result.options.map(days)).toEqual([3, 3, 3]);
  });

  it('does not pad an exact product request with unrelated or duplicate bottles', () => {
    const result = generateCorporateGiftingQuotes(catalog, {
      ...bottleRequest, selection: { mode: 'product', query: 'Mizu Steel Bottle' },
    });
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.options).toHaveLength(1);
    expect(signature(result.options[0])).toBe('prod-steel-bottle');
  });

  it('keeps two valid choices when a third exceeds the budget', () => {
    const result = generateCorporateGiftingQuotes(catalog, { ...bottleRequest, maxUnitPaise: 32_000 });
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.options).toHaveLength(2);
    expect(new Set(result.options.map(signature)).size).toBe(2);
    expect(result.options.every(option => option.unitTotalPaise <= 32_000)).toBe(true);
  });

  it('never fills an option slot with a stock, deadline, constraint or margin failure', () => {
    const valid = sampleBottle('valid', 10_000, 1);
    const result = generateCorporateGiftingQuotes([
      valid,
      { ...sampleBottle('out-of-stock', 12_000, 2), availableQuantity: 0 },
      sampleBottle('too-late', 12_000, 30),
      { ...sampleBottle('not-vegan', 12_000, 2), tags: [] },
      { ...sampleBottle('low-margin', 12_000, 2), unitCostPaise: 12_000 },
    ], { ...bottleRequest, hardConstraints: ['vegan'] });
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.options).toHaveLength(1);
    expect(signature(result.options[0])).toBe('valid');
  });

  it('is stable across catalog ordering and tied scores', () => {
    const products = [sampleBottle('c', 12_000, 2), sampleBottle('a', 12_000, 2), sampleBottle('b', 12_000, 2)];
    expect(generateCorporateGiftingQuotes(products, bottleRequest)).toEqual(
      generateCorporateGiftingQuotes([...products].reverse(), bottleRequest),
    );
  });
});

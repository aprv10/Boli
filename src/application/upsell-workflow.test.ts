import { describe, expect, it, vi } from 'vitest';
import { acceptSafeUpsell, eligibleUpsellProducts } from './upsell-workflow';
import { loadPublicDealRoom } from './quote-workflow';
import { recordedRecommendation } from './recommendation-workflow';
import type { CatalogProduct } from '@/src/domain/quoting/types';

vi.mock('./quote-workflow', async importOriginal => ({
  ...await importOriginal<typeof import('./quote-workflow')>(), loadPublicDealRoom: vi.fn(),
}));
vi.mock('./recommendation-workflow', () => ({ recordedRecommendation: vi.fn(), recommendationContext: vi.fn() }));

const now = '2026-09-03T12:00:00.000Z';
type Room = Parameters<typeof eligibleUpsellProducts>[0];
function product(id: string, category = 'accessory'): CatalogProduct {
  return { id, sku: id, name: id, category, tags: ['vegan', 'plastic-free', 'brandable'],
    unitPricePaise: 10000, unitCostPaise: 5000, availableQuantity: 80, leadTimeDays: 3 };
}
function room(): Room {
  const base = product('base', 'drinkware');
  return {
    evaluatedAt: now,
    deal: { id: 'deal', merchantId: 'merchant', intentId: 'intent', publicToken: 'token', createdAt: now,
      rawText: '80 welcome kits', selection: { mode: 'kit', query: 'welcome kits' }, customRequirements: [],
      quantity: 80, maxUnitPaise: 90000, deadline: '2026-09-24', hardConstraints: ['vegan', 'plastic-free'],
      deliveryLocations: ['Chennai'], agentInterpretation: null },
    policy: { version: 1, minimumMarginBps: 2200, maximumAutomaticConcessionBps: 200 },
    catalog: [base, product('addon')], result: { status: 'rejected', reasons: [], evaluatedCombinations: 0 },
    currentQuote: { id: 'quote', dealId: 'deal', version: 1, optionKey: 'best-value', label: 'Cheapest', rationale: '',
      lines: [{ code: base.sku, label: base.name, kind: 'product', productId: base.id, unitPricePaise: 70000, unitCostPaise: 5000 }],
      checks: [], quantity: 80, unitTotalPaise: 70000, orderTotalPaise: 5600000, unitCostPaise: 5000,
      contributionMarginBps: 9285, policyVersion: 1, intentHash: 'i'.repeat(64), quoteHash: 'a'.repeat(64),
      status: 'merchant_approved', expiresAt: '2026-09-05T12:00:00.000Z', createdAt: now, approvedAt: now, acceptedAt: null },
    quoteHistory: [], events: [], auditVerified: true, auditHeadHash: '',
  };
}

describe('deterministic upsell boundary', () => {
  it('includes only eligible, not-already-included accessories', () => {
    const input = room();
    input.catalog.push(product('another-drink', 'drinkware'));
    expect(eligibleUpsellProducts(input, now).map(item => item.id)).toEqual(['addon']);
  });

  it.each(['stock', 'delivery', 'diet', 'plastic', 'budget', 'margin'] as const)('excludes add-ons failing %s', failure => {
    const input = room();
    const addon = input.catalog[1];
    if (failure === 'stock') addon.availableQuantity = 79; // Already net of reservations.
    if (failure === 'delivery') addon.leadTimeDays = 30;
    if (failure === 'diet') addon.tags = ['plastic-free'];
    if (failure === 'plastic') addon.tags = ['vegan'];
    if (failure === 'budget') addon.unitPricePaise = 25000;
    if (failure === 'margin') addon.unitCostPaise = 75000;
    expect(eligibleUpsellProducts(input, now)).toEqual([]);
  });

  it('checks current base-product stock, cost and eligibility as well', () => {
    for (const change of [
      (base: CatalogProduct) => { base.availableQuantity = 0; },
      (base: CatalogProduct) => { base.unitCostPaise = 75000; },
      (base: CatalogProduct) => { base.tags = []; },
    ]) {
      const input = room(); change(input.catalog[0]);
      expect(eligibleUpsellProducts(input, now)).toEqual([]);
    }
  });

  it('does not upsell expired/accepted quotes, single-product requests or mandatory custom requirements', () => {
    const expired = room(); expired.currentQuote!.expiresAt = now;
    const accepted = room(); accepted.currentQuote!.status = 'buyer_accepted';
    const single = room(); single.deal.selection = { mode: 'product', query: 'bottle' };
    const custom = room(); custom.deal.customRequirements = [{ text: 'Nut allergy certification', priority: 'required' }];
    for (const input of [expired, accepted, single, custom]) expect(eligibleUpsellProducts(input, now)).toEqual([]);
  });

  it('rejects stale display prices and unrecognized products without asking Mistral to reselect', async () => {
    vi.mocked(loadPublicDealRoom).mockResolvedValue(room());
    for (const selection of [{ productId: 'addon', expectedUnitPricePaise: 1 }, { productId: 'invented', expectedUnitPricePaise: 10000 }]) {
      await expect(acceptSafeUpsell({} as D1Database, 'token', 'a'.repeat(64), selection, now))
        .rejects.toMatchObject({ code: 'UPSELL_UNAVAILABLE', status: 409 });
    }
    expect(recordedRecommendation).not.toHaveBeenCalled();
  });
});

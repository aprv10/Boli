import { describe, expect, it } from 'vitest';
import { evaluateBoundedCounteroffer } from './bounded-counteroffer';
import type { QuoteEngineResult, QuoteOption } from '../quoting/types';

function option(unitTotalPaise: number, marginBps = 3_000): QuoteOption {
  return {
    key: 'best-value',
    label: 'Best value',
    rationale: 'Fixture',
    lines: [
      {
        code: `sku-${unitTotalPaise}`,
        label: 'Fixture product',
        kind: 'product',
        productId: `product-${unitTotalPaise}`,
        unitPricePaise: unitTotalPaise,
        unitCostPaise: Math.floor(unitTotalPaise * 0.7),
      },
    ],
    productUnitPaise: unitTotalPaise,
    serviceUnitPaise: 0,
    unitTotalPaise,
    orderTotalPaise: unitTotalPaise * 100,
    unitCostPaise: Math.floor(unitTotalPaise * 0.7),
    contributionMarginBps: marginBps,
    headroomPaise: 0,
    checks: [],
  };
}

function generated(...options: QuoteOption[]): QuoteEngineResult {
  return {
    status: 'generated',
    options,
    evaluatedCombinations: options.length,
    feasibleCombinations: options.length,
  };
}

const rejected: QuoteEngineResult = {
  status: 'rejected',
  reasons: [{ code: 'NO_SAFE_QUOTE', message: 'No safe quote.' }],
  evaluatedCombinations: 1,
};

describe('evaluateBoundedCounteroffer', () => {
  it('automatically approves a safe concession within authority', () => {
    const result = evaluateBoundedCounteroffer({
      sourceQuote: option(80_000),
      targetUnitPaise: 75_000,
      originalMaxUnitPaise: 90_000,
      hardConstraints: ['vegan', 'plastic-free'],
      targetResult: generated(option(74_000), option(75_000)),
      baselineResult: generated(option(68_000)),
    });

    expect(result.status).toBe('auto_approved');
    expect(result.proposedUnitPaise).toBe(75_000);
    expect(result.reasonCodes).toContain('WITHIN_AUTOMATIC_NEGOTIATION_AUTHORITY');
    expect(result.checks.find((check) => check.code === 'HARD_CONSTRAINTS_PRESERVED'))
      .toMatchObject({ passed: true, observed: 'vegan,plastic-free' });
  });

  it('counters at the safe floor when the buyer target is impossible', () => {
    const result = evaluateBoundedCounteroffer({
      sourceQuote: option(80_000),
      targetUnitPaise: 72_000,
      originalMaxUnitPaise: 90_000,
      hardConstraints: ['vegan'],
      targetResult: rejected,
      baselineResult: generated(option(73_000)),
    });

    expect(result.status).toBe('bounded_counteroffer');
    expect(result.targetMet).toBe(false);
    expect(result.proposedUnitPaise).toBe(73_000);
    expect(result.reasonCodes).toEqual(['BUYER_TARGET_BELOW_SAFE_FLOOR']);
  });

  it('requires approval when the safe concession exceeds automatic authority', () => {
    const result = evaluateBoundedCounteroffer({
      sourceQuote: option(90_000),
      targetUnitPaise: 70_000,
      originalMaxUnitPaise: 95_000,
      hardConstraints: [],
      targetResult: generated(option(70_000)),
      baselineResult: generated(option(65_000)),
    });

    expect(result.status).toBe('merchant_approval_required');
    expect(result.concessionBps).toBeGreaterThan(1_200);
  });

  it('rejects attempts that do not lower the executable quote', () => {
    const result = evaluateBoundedCounteroffer({
      sourceQuote: option(80_000),
      targetUnitPaise: 82_000,
      originalMaxUnitPaise: 90_000,
      hardConstraints: [],
      targetResult: generated(option(80_000)),
      baselineResult: generated(option(70_000)),
    });

    expect(result.status).toBe('rejected');
    expect(result.proposedOption).toBeNull();
    expect(result.reasonCodes).toEqual(['TARGET_NOT_LOWER_THAN_CURRENT_QUOTE']);
  });
});

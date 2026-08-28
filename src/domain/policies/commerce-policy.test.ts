import { describe, expect, it } from 'vitest';
import { evaluateCommerceAction, type MerchantPolicy } from './commerce-policy';

const policy: MerchantPolicy = {
  version: 1,
  minimumMarginBps: 2_200,
  maximumAutomaticConcessionBps: 1_200,
};

const safeQuote = {
  status: 'merchant_approved' as const,
  unitTotalPaise: 85_000,
  contributionMarginBps: 3_100,
  expiresAt: '2026-09-10T00:00:00.000Z',
  quoteHash: 'quote-hash',
  checks: [
    {
      code: 'HARD_CONSTRAINT_VEGAN',
      passed: true,
      observed: 'satisfied',
      required: 'vegan',
    },
  ],
};

describe('evaluateCommerceAction', () => {
  it('allows acceptance only when hash, state, expiry, budget, margin and locks pass', () => {
    const decision = evaluateCommerceAction({
      action: 'accept_quote',
      policy,
      now: '2026-09-01T00:00:00.000Z',
      buyerMaxUnitPaise: 90_000,
      expectedQuoteHash: 'quote-hash',
      quote: safeQuote,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.policyVersion).toBe(1);
    expect(decision.reasonCodes).toEqual(['POLICY_CHECKS_PASSED']);
  });

  it('fails closed for a stale quote hash', () => {
    const decision = evaluateCommerceAction({
      action: 'accept_quote',
      policy,
      now: '2026-09-01T00:00:00.000Z',
      buyerMaxUnitPaise: 90_000,
      expectedQuoteHash: 'different-hash',
      quote: safeQuote,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain('QUOTE_HASH_MATCH_FAILED');
  });

  it('routes a commercially safe but oversized automatic concession to approval', () => {
    const decision = evaluateCommerceAction({
      action: 'auto_issue_counteroffer',
      policy,
      now: '2026-09-01T00:00:00.000Z',
      buyerMaxUnitPaise: 90_000,
      concessionBps: 1_900,
      quote: { ...safeQuote, status: 'candidate' },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.approvalRequired).toBe(true);
    expect(decision.reasonCodes).toEqual([
      'AUTOMATIC_CONCESSION_LIMIT_FAILED',
    ]);
  });

  it('never treats a margin breach as an approval-only exception', () => {
    const decision = evaluateCommerceAction({
      action: 'merchant_approve_counteroffer',
      policy,
      now: '2026-09-01T00:00:00.000Z',
      buyerMaxUnitPaise: 90_000,
      quote: { ...safeQuote, contributionMarginBps: 1_900 },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.approvalRequired).toBe(false);
    expect(decision.reasonCodes).toContain('MERCHANT_MARGIN_FLOOR_FAILED');
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluateCommerceAction, type MerchantPolicy } from '@/src/domain/policies/commerce-policy';
import { reconcileCapturedPayment } from './reconciliation';

const policy: MerchantPolicy = {
  version: 1,
  minimumMarginBps: 2_200,
  maximumAutomaticConcessionBps: 1_200,
};
const quote = {
  status: 'buyer_accepted' as const,
  unitTotalPaise: 80_000,
  contributionMarginBps: 3_000,
  checks: [{ code: 'HARD_CONSTRAINT_VEGAN', passed: true, observed: 'satisfied', required: 'vegan' }],
};

describe('payment invariants', () => {
  it('rejects every refund above the captured remainder', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (capturedAmountPaise, randomRefunded) => {
          const alreadyRefundedPaise = Math.min(randomRefunded, capturedAmountPaise);
          const remainder = capturedAmountPaise - alreadyRefundedPaise;
          const decision = evaluateCommerceAction({
            action: 'issue_refund',
            policy,
            now: '2026-09-01T00:00:00.000Z',
            buyerMaxUnitPaise: 90_000,
            capturedAmountPaise,
            alreadyRefundedPaise,
            requestedRefundPaise: remainder + 1,
            quote,
          });
          expect(decision.allowed).toBe(false);
          expect(decision.reasonCodes).toContain('REFUND_WITHIN_CAPTURED_BALANCE_FAILED');
        },
      ),
    );
  });

  it('rejects every captured-payment amount mutation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (amountPaise, delta) => {
          const decision = reconcileCapturedPayment({
            expected: { providerOrderId: 'order_test', amountPaise, currency: 'INR' },
            observed: {
              providerOrderId: 'order_test',
              amountPaise: amountPaise + delta,
              currency: 'INR',
              status: 'captured',
            },
          });
          expect(decision.allowed).toBe(false);
          expect(decision.reasonCodes).toContain('PAYMENT_AMOUNT_MATCH_FAILED');
        },
      ),
    );
  });
});

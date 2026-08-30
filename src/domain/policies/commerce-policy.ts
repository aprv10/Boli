import type { ConstraintCheck } from '../quoting/types';

export type CommerceAction =
  | 'approve_quote'
  | 'auto_issue_counteroffer'
  | 'merchant_approve_counteroffer'
  | 'accept_quote'
  | 'create_checkout'
  | 'issue_refund';

export type MerchantPolicy = {
  version: number;
  minimumMarginBps: number;
  maximumAutomaticConcessionBps: number;
};

export type PolicyDecision = {
  allowed: boolean;
  approvalRequired: boolean;
  policyVersion: number;
  reasonCodes: string[];
  checks: ConstraintCheck[];
};

type EvaluateCommerceActionInput = {
  action: CommerceAction;
  policy: MerchantPolicy;
  now: string;
  buyerMaxUnitPaise: number;
  quote: {
    status?: 'candidate' | 'merchant_approved' | 'buyer_accepted' | 'superseded' | 'expired';
    unitTotalPaise: number;
    contributionMarginBps: number;
    expiresAt?: string;
    quoteHash?: string;
    checks: ConstraintCheck[];
  };
  expectedQuoteHash?: string;
  concessionBps?: number;
  inventoryAvailable?: boolean;
  capturedAmountPaise?: number;
  alreadyRefundedPaise?: number;
  requestedRefundPaise?: number;
};

function check(
  code: string,
  passed: boolean,
  observed: string | number,
  required: string,
): ConstraintCheck {
  return { code, passed, observed: String(observed), required };
}

export function evaluateCommerceAction({
  action,
  policy,
  now,
  buyerMaxUnitPaise,
  quote,
  expectedQuoteHash,
  concessionBps = 0,
  inventoryAvailable,
  capturedAmountPaise = 0,
  alreadyRefundedPaise = 0,
  requestedRefundPaise = 0,
}: EvaluateCommerceActionInput): PolicyDecision {
  const checks: ConstraintCheck[] = [
    check(
      'BUYER_UNIT_BUDGET',
      quote.unitTotalPaise <= buyerMaxUnitPaise,
      quote.unitTotalPaise,
      `<=${buyerMaxUnitPaise}`,
    ),
    check(
      'MERCHANT_MARGIN_FLOOR',
      quote.contributionMarginBps >= policy.minimumMarginBps,
      quote.contributionMarginBps,
      `>=${policy.minimumMarginBps}`,
    ),
    check(
      'HARD_CONSTRAINTS_SATISFIED',
      quote.checks
        .filter((item) => item.code.startsWith('HARD_CONSTRAINT_'))
        .every((item) => item.passed),
      quote.checks
        .filter((item) => item.code.startsWith('HARD_CONSTRAINT_'))
        .every((item) => item.passed)
        ? 'all_passed'
        : 'failed',
      'all_passed',
    ),
  ];

  if (expectedQuoteHash !== undefined) {
    checks.push(
      check(
        'QUOTE_HASH_MATCH',
        quote.quoteHash === expectedQuoteHash,
        quote.quoteHash ?? 'missing',
        expectedQuoteHash,
      ),
    );
  }

  if (quote.expiresAt !== undefined) {
    checks.push(
      check(
        'QUOTE_NOT_EXPIRED',
        Date.parse(quote.expiresAt) > Date.parse(now),
        quote.expiresAt,
        `>${now}`,
      ),
    );
  }

  if (action === 'accept_quote') {
    checks.push(
      check(
        'QUOTE_STATE_ACCEPTABLE',
        quote.status === 'merchant_approved',
        quote.status ?? 'missing',
        'merchant_approved',
      ),
    );
  }

  if (action === 'create_checkout') {
    checks.push(
      check(
        'QUOTE_STATE_ACCEPTED',
        quote.status === 'buyer_accepted',
        quote.status ?? 'missing',
        'buyer_accepted',
      ),
      check(
        'INVENTORY_STILL_AVAILABLE',
        inventoryAvailable === true,
        inventoryAvailable === true ? 'available' : 'unavailable',
        'available',
      ),
    );
  }

  if (action === 'issue_refund') {
    const refundablePaise = Math.max(0, capturedAmountPaise - alreadyRefundedPaise);
    checks.push(
      check(
        'PAYMENT_CAPTURED',
        capturedAmountPaise > 0,
        capturedAmountPaise,
        '>0',
      ),
      check(
        'REFUND_AMOUNT_POSITIVE',
        requestedRefundPaise > 0,
        requestedRefundPaise,
        '>0',
      ),
      check(
        'REFUND_WITHIN_CAPTURED_BALANCE',
        requestedRefundPaise > 0 && requestedRefundPaise <= refundablePaise,
        requestedRefundPaise,
        `<=${refundablePaise}`,
      ),
    );
  }

  if (action === 'auto_issue_counteroffer') {
    checks.push(
      check(
        'AUTOMATIC_CONCESSION_LIMIT',
        concessionBps <= policy.maximumAutomaticConcessionBps,
        concessionBps,
        `<=${policy.maximumAutomaticConcessionBps}`,
      ),
    );
  }

  const failedCodes = checks
    .filter((item) => !item.passed)
    .map((item) => item.code);
  const approvalRequired =
    action === 'auto_issue_counteroffer' &&
    failedCodes.length === 1 &&
    failedCodes[0] === 'AUTOMATIC_CONCESSION_LIMIT';

  return {
    allowed: failedCodes.length === 0,
    approvalRequired,
    policyVersion: policy.version,
    reasonCodes:
      failedCodes.length === 0
        ? ['POLICY_CHECKS_PASSED']
        : failedCodes.map((code) => `${code}_FAILED`),
    checks,
  };
}

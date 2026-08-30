export type PaymentFactCheck = {
  code: string;
  passed: boolean;
  observed: string;
  required: string;
};

export function reconcileCapturedPayment(input: {
  expected: { providerOrderId: string; amountPaise: number; currency: 'INR' };
  observed: {
    providerOrderId: string;
    amountPaise: number;
    currency: string;
    status: string;
  };
}) {
  const checks: PaymentFactCheck[] = [
    {
      code: 'PAYMENT_ORDER_MATCH',
      passed: input.observed.providerOrderId === input.expected.providerOrderId,
      observed: input.observed.providerOrderId,
      required: input.expected.providerOrderId,
    },
    {
      code: 'PAYMENT_AMOUNT_MATCH',
      passed: input.observed.amountPaise === input.expected.amountPaise,
      observed: String(input.observed.amountPaise),
      required: String(input.expected.amountPaise),
    },
    {
      code: 'PAYMENT_CURRENCY_MATCH',
      passed: input.observed.currency === input.expected.currency,
      observed: input.observed.currency,
      required: input.expected.currency,
    },
    {
      code: 'PAYMENT_CAPTURED',
      passed: input.observed.status === 'captured',
      observed: input.observed.status,
      required: 'captured',
    },
  ];
  const failures = checks.filter((check) => !check.passed);
  return {
    allowed: failures.length === 0,
    checks,
    reasonCodes:
      failures.length === 0
        ? ['PAYMENT_FACTS_MATCHED']
        : failures.map((check) => `${check.code}_FAILED`),
  };
}

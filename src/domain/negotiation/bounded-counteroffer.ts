import type {
  ConstraintCheck,
  HardConstraint,
  QuoteEngineResult,
  QuoteOption,
} from '../quoting/types';

export const DEFAULT_NEGOTIATION_POLICY = {
  minimumMarginBps: 2_200,
  maximumAutomaticConcessionBps: 1_200,
} as const;

export type CounterofferSourceQuote = Pick<
  QuoteOption,
  'unitTotalPaise' | 'contributionMarginBps' | 'lines'
>;

export type CounterofferDecision = {
  status:
    | 'auto_approved'
    | 'bounded_counteroffer'
    | 'merchant_approval_required'
    | 'rejected';
  proposedOption: QuoteOption | null;
  targetUnitPaise: number;
  proposedUnitPaise: number | null;
  targetMet: boolean;
  concessionBps: number;
  checks: ConstraintCheck[];
  reasonCodes: string[];
  summary: string;
};

type EvaluateCounterofferInput = {
  sourceQuote: CounterofferSourceQuote;
  targetUnitPaise: number;
  originalMaxUnitPaise: number;
  hardConstraints: HardConstraint[];
  targetResult: QuoteEngineResult;
  baselineResult: QuoteEngineResult;
  policy?: {
    minimumMarginBps: number;
    maximumAutomaticConcessionBps: number;
  };
};

function productSignature(option: Pick<QuoteOption, 'lines'>) {
  return option.lines
    .filter((line) => line.kind === 'product')
    .map((line) => line.productId ?? line.code)
    .sort()
    .join(':');
}

function richestOption(result: QuoteEngineResult) {
  if (result.status !== 'generated') return null;
  return [...result.options].sort(
    (left, right) => right.unitTotalPaise - left.unitTotalPaise,
  )[0] ?? null;
}

function cheapestOption(result: QuoteEngineResult) {
  if (result.status !== 'generated') return null;
  return [...result.options].sort(
    (left, right) => left.unitTotalPaise - right.unitTotalPaise,
  )[0] ?? null;
}

export function evaluateBoundedCounteroffer({
  sourceQuote,
  targetUnitPaise,
  originalMaxUnitPaise,
  hardConstraints,
  targetResult,
  baselineResult,
  policy = DEFAULT_NEGOTIATION_POLICY,
}: EvaluateCounterofferInput): CounterofferDecision {
  if (!Number.isSafeInteger(targetUnitPaise) || targetUnitPaise <= 0) {
    throw new Error('targetUnitPaise must be a positive integer.');
  }

  if (targetUnitPaise >= sourceQuote.unitTotalPaise) {
    return {
      status: 'rejected',
      proposedOption: null,
      targetUnitPaise,
      proposedUnitPaise: null,
      targetMet: false,
      concessionBps: 0,
      checks: [
        {
          code: 'LOWER_PRICE_REQUESTED',
          passed: false,
          observed: String(targetUnitPaise),
          required: `<${sourceQuote.unitTotalPaise}`,
        },
      ],
      reasonCodes: ['TARGET_NOT_LOWER_THAN_CURRENT_QUOTE'],
      summary: 'The requested amount does not lower the current executable quote.',
    };
  }

  const targetOption = richestOption(targetResult);
  const floorOption = cheapestOption(baselineResult);
  const proposedOption = targetOption ?? floorOption;

  if (
    !proposedOption ||
    proposedOption.unitTotalPaise >= sourceQuote.unitTotalPaise ||
    (proposedOption.unitTotalPaise === sourceQuote.unitTotalPaise &&
      productSignature(proposedOption) === productSignature(sourceQuote))
  ) {
    return {
      status: 'rejected',
      proposedOption: null,
      targetUnitPaise,
      proposedUnitPaise: null,
      targetMet: false,
      concessionBps: 0,
      checks: [
        {
          code: 'LOWER_POLICY_SAFE_CONFIGURATION',
          passed: false,
          observed: floorOption ? String(floorOption.unitTotalPaise) : 'unavailable',
          required: `<${sourceQuote.unitTotalPaise}`,
        },
      ],
      reasonCodes: ['NO_LOWER_POLICY_SAFE_CONFIGURATION'],
      summary:
        'No lower-priced configuration preserves the buyer constraints and merchant margin floor.',
    };
  }

  const targetMet = proposedOption.unitTotalPaise <= targetUnitPaise;
  const concessionBps = Math.floor(
    ((sourceQuote.unitTotalPaise - proposedOption.unitTotalPaise) * 10_000) /
      sourceQuote.unitTotalPaise,
  );
  const withinAutomaticAuthority =
    concessionBps <= policy.maximumAutomaticConcessionBps;
  const checks: ConstraintCheck[] = [
    {
      code: 'BUYER_TARGET_PRICE',
      passed: targetMet,
      observed: String(proposedOption.unitTotalPaise),
      required: `<=${targetUnitPaise}`,
    },
    {
      code: 'BUYER_ORIGINAL_CAP',
      passed: proposedOption.unitTotalPaise <= originalMaxUnitPaise,
      observed: String(proposedOption.unitTotalPaise),
      required: `<=${originalMaxUnitPaise}`,
    },
    {
      code: 'MERCHANT_MARGIN_FLOOR',
      passed: proposedOption.contributionMarginBps >= policy.minimumMarginBps,
      observed: String(proposedOption.contributionMarginBps),
      required: `>=${policy.minimumMarginBps}`,
    },
    {
      code: 'AUTOMATIC_CONCESSION_LIMIT',
      passed: withinAutomaticAuthority,
      observed: String(concessionBps),
      required: `<=${policy.maximumAutomaticConcessionBps}`,
    },
    {
      code: 'HARD_CONSTRAINTS_PRESERVED',
      passed: true,
      observed: hardConstraints.length ? hardConstraints.join(',') : 'none',
      required: 'unchanged',
    },
  ];

  if (!withinAutomaticAuthority) {
    return {
      status: 'merchant_approval_required',
      proposedOption,
      targetUnitPaise,
      proposedUnitPaise: proposedOption.unitTotalPaise,
      targetMet,
      concessionBps,
      checks,
      reasonCodes: ['AUTOMATIC_CONCESSION_LIMIT_EXCEEDED'],
      summary: targetMet
        ? 'A safe configuration meets the buyer target, but its concession exceeds Boli’s automatic authority.'
        : 'The lowest safe counteroffer exceeds Boli’s automatic authority and needs merchant approval.',
    };
  }

  if (!targetMet) {
    return {
      status: 'bounded_counteroffer',
      proposedOption,
      targetUnitPaise,
      proposedUnitPaise: proposedOption.unitTotalPaise,
      targetMet: false,
      concessionBps,
      checks,
      reasonCodes: ['BUYER_TARGET_BELOW_SAFE_FLOOR'],
      summary:
        'The buyer target is below the safe floor, so Boli issued the lowest policy-safe counteroffer.',
    };
  }

  return {
    status: 'auto_approved',
    proposedOption,
    targetUnitPaise,
    proposedUnitPaise: proposedOption.unitTotalPaise,
    targetMet: true,
    concessionBps,
    checks,
    reasonCodes: ['WITHIN_AUTOMATIC_NEGOTIATION_AUTHORITY'],
    summary:
      'Boli found a lower configuration that meets the buyer target and remains inside merchant policy.',
  };
}

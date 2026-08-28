import type { HardConstraint, QuoteOption } from './types';

type FingerprintInput = {
  dealId: string;
  intentId: string;
  version: number;
  quantity: number;
  maxUnitPaise: number;
  deliveryLocations: string[];
  deadline: string;
  hardConstraints: HardConstraint[];
  policyVersion: number;
  option: QuoteOption;
  expiresAt: string;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export async function sha256Hex(value: unknown) {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function createQuoteFingerprints(input: FingerprintInput) {
  const intentHash = await sha256Hex({
    schema: 'boli.purchase-intent.v1',
    dealId: input.dealId,
    intentId: input.intentId,
    quantity: input.quantity,
    maxUnitPaise: input.maxUnitPaise,
    deliveryLocations: input.deliveryLocations,
    deadline: input.deadline,
    hardConstraints: [...input.hardConstraints].sort(),
  });

  const quoteHash = await sha256Hex({
    schema: 'boli.executable-quote.v1',
    dealId: input.dealId,
    intentHash,
    version: input.version,
    policyVersion: input.policyVersion,
    optionKey: input.option.key,
    quantity: input.quantity,
    currency: 'INR',
    lines: input.option.lines,
    unitTotalPaise: input.option.unitTotalPaise,
    orderTotalPaise: input.option.orderTotalPaise,
    unitCostPaise: input.option.unitCostPaise,
    contributionMarginBps: input.option.contributionMarginBps,
    checks: input.option.checks,
    expiresAt: input.expiresAt,
  });

  return { intentHash, quoteHash };
}

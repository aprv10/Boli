import type {
  CatalogProduct,
  ConstraintCheck,
  HardConstraint,
  QuoteEngineResult,
  QuoteLine,
  QuoteOption,
  QuoteRequest,
} from './types';

const REQUIRED_SLOTS = [
  'container',
  'drinkware',
  'stationery',
  'snack',
  'packaging',
] as const;

const DEFAULT_MARGIN_BPS = 2_200;

type Candidate = Omit<QuoteOption, 'key' | 'label' | 'rationale'>;

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function leadDaysAvailable(deadline: string, now: string) {
  const deadlineMs = Date.parse(`${deadline}T23:59:59Z`);
  const nowMs = Date.parse(now);
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 86_400_000));
}

function productMeetsConstraints(
  product: CatalogProduct,
  hardConstraints: HardConstraint[],
) {
  if (hardConstraints.includes('vegan') && !product.tags.includes('vegan')) {
    return false;
  }
  if (
    hardConstraints.includes('plastic-free') &&
    !product.tags.includes('plastic-free')
  ) {
    return false;
  }
  return true;
}

function serviceLines(request: QuoteRequest, basePaise: number): QuoteLine[] {
  const brandingRequired = request.hardConstraints.includes('branded');
  const assembly: QuoteLine = {
    code: 'assembly',
    label: 'Kit assembly',
    kind: 'service',
    unitPricePaise: 4_500,
    unitCostPaise: 2_200,
  };
  const branding: QuoteLine | undefined = brandingRequired
    ? {
        code: 'branding',
        label: 'Logo application + setup',
        kind: 'service',
        unitPricePaise: 2_500 + Math.ceil(150_000 / request.quantity),
        unitCostPaise: 1_200 + Math.ceil(50_000 / request.quantity),
      }
    : undefined;
  const delivery: QuoteLine = {
    code: 'delivery',
    label: `Delivery allocation · ${request.deliveryLocations.length} ${request.deliveryLocations.length === 1 ? 'city' : 'cities'}`,
    kind: 'service',
    unitPricePaise: request.deliveryLocations.length * 1_800,
    unitCostPaise: request.deliveryLocations.length * 900,
  };

  const beforePaymentReserve =
    basePaise + assembly.unitPricePaise + (branding?.unitPricePaise ?? 0) + delivery.unitPricePaise;
  const paymentReserve: QuoteLine = {
    code: 'payment-reserve',
    label: 'Payment cost reserve',
    kind: 'service',
    unitPricePaise: Math.ceil(beforePaymentReserve * 0.02),
    unitCostPaise: Math.ceil(beforePaymentReserve * 0.02),
  };

  return [assembly, ...(branding ? [branding] : []), delivery, paymentReserve];
}

function buildCandidate(
  products: CatalogProduct[],
  request: QuoteRequest,
  minimumMarginBps: number,
): Candidate | undefined {
  if (
    request.hardConstraints.includes('branded') &&
    products.filter((product) => product.tags.includes('brandable')).length < 2
  ) {
    return undefined;
  }

  const productLines: QuoteLine[] = products.map((product) => ({
    code: product.sku,
    label: product.name,
    kind: 'product',
    productId: product.id,
    unitPricePaise: product.unitPricePaise,
    unitCostPaise: product.unitCostPaise,
  }));
  const productUnitPaise = sum(productLines.map((line) => line.unitPricePaise));
  const services = serviceLines(request, productUnitPaise);
  const serviceUnitPaise = sum(services.map((line) => line.unitPricePaise));
  const unitTotalPaise = productUnitPaise + serviceUnitPaise;
  const unitCostPaise = sum(
    [...productLines, ...services].map((line) => line.unitCostPaise),
  );
  const contributionMarginBps = Math.floor(
    ((unitTotalPaise - unitCostPaise) * 10_000) / unitTotalPaise,
  );

  if (
    unitTotalPaise > request.maxUnitPaise ||
    contributionMarginBps < minimumMarginBps
  ) {
    return undefined;
  }

  const maxLeadTime = Math.max(...products.map((product) => product.leadTimeDays));
  const checks: ConstraintCheck[] = [
    {
      code: 'BUYER_UNIT_BUDGET',
      passed: true,
      observed: String(unitTotalPaise),
      required: `<=${request.maxUnitPaise}`,
    },
    {
      code: 'MERCHANT_MARGIN_FLOOR',
      passed: true,
      observed: String(contributionMarginBps),
      required: `>=${minimumMarginBps}`,
    },
    {
      code: 'INVENTORY_AVAILABLE',
      passed: true,
      observed: String(Math.min(...products.map((product) => product.availableQuantity))),
      required: `>=${request.quantity}`,
    },
    {
      code: 'LEAD_TIME_FEASIBLE',
      passed: true,
      observed: `${maxLeadTime}d`,
      required: `<=${leadDaysAvailable(request.deadline, request.now ?? new Date().toISOString())}d`,
    },
    ...request.hardConstraints.map((constraint) => ({
      code: `HARD_CONSTRAINT_${constraint.toUpperCase().replace('-', '_')}`,
      passed: true,
      observed: 'satisfied',
      required: constraint,
    })),
  ];

  return {
    lines: [...productLines, ...services],
    productUnitPaise,
    serviceUnitPaise,
    unitTotalPaise,
    orderTotalPaise: unitTotalPaise * request.quantity,
    unitCostPaise,
    contributionMarginBps,
    headroomPaise: request.maxUnitPaise - unitTotalPaise,
    checks,
  };
}

function withIdentity(
  candidate: Candidate,
  key: QuoteOption['key'],
): QuoteOption {
  const content = {
    'best-value': {
      label: 'Best value',
      rationale: 'The lowest feasible price while preserving every locked constraint.',
    },
    balanced: {
      label: 'Balanced welcome',
      rationale: 'Uses more of the available mandate without drifting toward the ceiling.',
    },
    'premium-under-cap': {
      label: 'Premium under cap',
      rationale: 'The richest valid kit that still stays inside the buyer’s hard limit.',
    },
  }[key];
  return { ...candidate, key, ...content };
}

export function generateCorporateGiftingQuotes(
  catalog: CatalogProduct[],
  request: QuoteRequest,
): QuoteEngineResult {
  const minimumMarginBps = request.minimumMarginBps ?? DEFAULT_MARGIN_BPS;
  const now = request.now ?? new Date().toISOString();
  const allowedLeadDays = leadDaysAvailable(request.deadline, now);
  const eligible = catalog.filter(
    (product) =>
      product.availableQuantity >= request.quantity &&
      product.leadTimeDays <= allowedLeadDays &&
      productMeetsConstraints(product, request.hardConstraints),
  );

  const bySlot = Object.fromEntries(
    REQUIRED_SLOTS.map((slot) => [
      slot,
      eligible.filter((product) => product.category === slot),
    ]),
  ) as Record<(typeof REQUIRED_SLOTS)[number], CatalogProduct[]>;

  const missingSlots = REQUIRED_SLOTS.filter((slot) => bySlot[slot].length === 0);
  if (missingSlots.length) {
    return {
      status: 'rejected',
      reasons: missingSlots.map((slot) => ({
        code: 'NO_ELIGIBLE_PRODUCT_FOR_SLOT',
        message: `No ${slot} satisfies stock, lead-time and locked constraints.`,
      })),
      evaluatedCombinations: 0,
    };
  }

  const candidates: Candidate[] = [];
  let evaluatedCombinations = 0;
  for (const container of bySlot.container) {
    for (const drinkware of bySlot.drinkware) {
      for (const stationery of bySlot.stationery) {
        for (const snack of bySlot.snack) {
          for (const packaging of bySlot.packaging) {
            evaluatedCombinations += 1;
            const candidate = buildCandidate(
              [container, drinkware, stationery, snack, packaging],
              { ...request, now },
              minimumMarginBps,
            );
            if (candidate) candidates.push(candidate);
          }
        }
      }
    }
  }

  if (!candidates.length) {
    return {
      status: 'rejected',
      reasons: [
        {
          code: 'NO_POLICY_SAFE_COMBINATION',
          message:
            'Available combinations exceed the buyer budget or fall below the merchant margin floor.',
        },
      ],
      evaluatedCombinations,
    };
  }

  candidates.sort((a, b) => a.unitTotalPaise - b.unitTotalPaise);
  const chosen: Candidate[] = [];
  const addUnique = (candidate: Candidate) => {
    const signature = candidate.lines
      .filter((line) => line.kind === 'product')
      .map((line) => line.productId)
      .join(':');
    if (
      !chosen.some(
        (existing) =>
          existing.lines
            .filter((line) => line.kind === 'product')
            .map((line) => line.productId)
            .join(':') === signature,
      )
    ) {
      chosen.push(candidate);
    }
  };

  addUnique(candidates[0]);
  const balancedTarget = request.maxUnitPaise * 0.82;
  addUnique(
    [...candidates].sort(
      (a, b) =>
        Math.abs(a.unitTotalPaise - balancedTarget) -
        Math.abs(b.unitTotalPaise - balancedTarget),
    )[0],
  );
  addUnique(candidates[candidates.length - 1]);

  const keys: QuoteOption['key'][] = [
    'best-value',
    'balanced',
    'premium-under-cap',
  ];
  return {
    status: 'generated',
    options: chosen.map((candidate, index) => withIdentity(candidate, keys[index])),
    evaluatedCombinations,
    feasibleCombinations: candidates.length,
  };
}

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
    basePaise + (request.selection?.mode === 'product' ? 0 : assembly.unitPricePaise) + (branding?.unitPricePaise ?? 0) + delivery.unitPricePaise;
  const paymentReserve: QuoteLine = {
    code: 'payment-reserve',
    label: 'Payment cost reserve',
    kind: 'service',
    unitPricePaise: Math.ceil(beforePaymentReserve * 0.02),
    unitCostPaise: Math.ceil(beforePaymentReserve * 0.02),
  };

  return [...(request.selection?.mode === 'product' ? [] : [assembly]), ...(branding ? [branding] : []), delivery, paymentReserve];
}

function buildCandidate(
  products: CatalogProduct[],
  request: QuoteRequest,
  minimumMarginBps: number,
): Candidate | undefined {
  if (
    request.hardConstraints.includes('branded') &&
    products.filter((product) => product.tags.includes('brandable')).length < (request.selection?.mode === 'product' ? 1 : 2)
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
    ...(request.selection ? [{ code: 'SHOPPING_SELECTION', passed: true, observed: JSON.stringify(request.selection), required: 'buyer-confirmed selection' }] : []),
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
      label: 'Cheapest',
      rationale: 'The lowest verified total that preserves every locked constraint.',
    },
    balanced: {
      label: 'Balanced',
      rationale: 'A price-and-delivery balance among the remaining valid options, with the cheapest and fastest choices shown separately.',
    },
    'premium-under-cap': {
      label: 'Fastest',
      rationale: 'The fastest distinct valid configuration available for this mandate.',
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

  if (request.selection?.mode === 'product') {
    const words = request.selection.query.toLowerCase().replace(/[^a-z0-9 -]/g, ' ').split(/\s+/).filter(Boolean).map(word => word.endsWith('s') ? word.slice(0, -1) : word);
    if (!words.length) return { status: 'rejected', reasons: [{ code: 'PRODUCT_QUERY_REQUIRED', message: 'Choose a product type or product name from the catalog.' }], evaluatedCombinations: 0 };
    const matching = eligible.filter(product => {
      const text = `${product.name} ${product.sku} ${product.category} ${product.tags.join(' ')}`.toLowerCase();
      return words.every(word => text.includes(word));
    });
    const candidates = matching.map(product => buildCandidate([product], request, minimumMarginBps)).filter((candidate): candidate is Candidate => Boolean(candidate));
    if (!candidates.length) return { status: 'rejected', reasons: [{ code: 'NO_MATCHING_PRODUCT', message: `No available product matching “${request.selection.query}” meets this quantity, budget, delivery date and requirements. Try the exact catalog name or adjust your request.` }], evaluatedCombinations: matching.length };
    return selectOptions(candidates, matching.length);
  }
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

  return selectOptions(candidates, evaluatedCombinations);
}

function selectOptions(candidates: Candidate[], evaluatedCombinations: number): QuoteEngineResult {
  const signature = (candidate: Candidate) => JSON.stringify(candidate.lines
    .filter(line => line.kind === 'product')
    .map(line => line.productId ?? line.code)
    .sort());
  const leadDays = (candidate: Candidate) => {
    const observed = candidate.checks.find((check) => check.code === 'LEAD_TIME_FEASIBLE')?.observed;
    return Number(observed?.replace('d', '') ?? Number.MAX_SAFE_INTEGER);
  };

  // Stable ties keep option keys consistent when database row order changes.
  const byPrice = (a: Candidate, b: Candidate) => a.unitTotalPaise - b.unitTotalPaise
    || leadDays(a) - leadDays(b) || signature(a).localeCompare(signature(b));
  const distinct = [...new Map([...candidates].sort(byPrice)
    .map(candidate => [signature(candidate), candidate])).values()];
  const cheapest = distinct[0];
  const fastestDays = Math.min(...distinct.map(leadDays));
  // Reserve a genuinely fastest option first so the balanced pick cannot take
  // its place. If cheapest is uniquely fastest, do not mislabel a slower SKU.
  const fastest = distinct.find(candidate => candidate !== cheapest && leadDays(candidate) === fastestDays);
  const minPrice = cheapest.unitTotalPaise;
  const minDays = Math.max(1, fastestDays);
  const score = (candidate: Candidate) => .7 * candidate.unitTotalPaise / minPrice + .3 * leadDays(candidate) / minDays;
  const byValue = (a: Candidate, b: Candidate) => score(a) - score(b) || byPrice(a, b);
  const balanced = distinct.filter(candidate => candidate !== cheapest && candidate !== fastest).sort(byValue)[0];
  const alternative = fastest ?? distinct.find(candidate => candidate !== cheapest && candidate !== balanced);
  const chosen = [withIdentity(cheapest, 'best-value')];
  if (balanced) chosen.push(withIdentity(balanced, 'balanced'));
  if (alternative) {
    const option = withIdentity(alternative, 'premium-under-cap');
    chosen.push(fastest ? option : {
      ...option,
      label: 'Another option',
      rationale: 'A different product configuration that meets your requirements. The cheapest option also has the shortest delivery time.',
    });
  }
  // A recommendation follows verified price/delivery, not a hardcoded card.
  const recommended = [...chosen].sort(byValue)[0];
  return {
    status: 'generated',
    options: chosen.map(option => ({
      ...option,
      label: option === recommended && option.key === 'balanced' ? 'Best Value' : option.label,
      recommended: option === recommended,
    })),
    evaluatedCombinations,
    feasibleCombinations: candidates.length,
  };
}

import { createQuoteFingerprints } from '@/src/domain/quoting/executable-quote';
import type { CatalogProduct, ConstraintCheck, HardConstraint, QuoteLine, QuoteOption } from '@/src/domain/quoting/types';
import { evaluateCommerceAction } from '@/src/domain/policies/commerce-policy';
import { prepareAuditBatch } from './audit-ledger';
import { loadPublicDealRoom, QuoteWorkflowError } from './quote-workflow';
import { requiresMerchantReview } from '@/src/domain/quoting/custom-requirements';
import { quoteAuthorityGuard } from './quote-authority-guard';
import { recordedRecommendation, recommendationContext } from './recommendation-workflow';
import { recommendationExplanation, type RecommendationCandidate } from './agent/mistral-recommendations';

const QUOTE_LIFETIME_MS = 48 * 60 * 60 * 1_000;

type UpsellRoom = NonNullable<Awaited<ReturnType<typeof loadPublicDealRoom>>>;

function daysAvailable(deadline: string, now: string) {
  return Math.max(
    0,
    Math.ceil((Date.parse(`${deadline}T23:59:59Z`) - Date.parse(now)) / 86_400_000),
  );
}

function satisfies(tags: string[], constraints: HardConstraint[]) {
  return (
    (!constraints.includes('vegan') || tags.includes('vegan')) &&
    (!constraints.includes('plastic-free') || tags.includes('plastic-free')) &&
    (!constraints.includes('branded') || tags.includes('brandable'))
  );
}

export function eligibleUpsellProducts(room: UpsellRoom, now: string): CatalogProduct[] {
  const quote = room.currentQuote;
  if (!quote || quote.status !== 'merchant_approved' || Date.parse(quote.expiresAt) <= Date.parse(now)) return [];
  if (Date.parse(`${room.deal.deadline}T23:59:59Z`) <= Date.parse(now)) return [];
  if (requiresMerchantReview(room.deal.customRequirements) || room.deal.selection?.mode === 'product') return [];
  const existingIds = new Set(quote.lines.map(line => line.productId));
  const existingProducts = quote.lines.filter(line => line.kind === 'product').map(line => room.catalog.find(product => product.id === line.productId));
  if (existingProducts.some(product => !product || product.availableQuantity < quote.quantity
    || product.leadTimeDays > daysAvailable(room.deal.deadline, now)
    || !satisfies(product.tags, room.deal.hardConstraints.filter(constraint => constraint !== 'branded')))) return [];
  if (room.deal.hardConstraints.includes('branded') && existingProducts.filter(product => product?.tags.includes('brandable')).length < 2) return [];
  const currentCost = quote.lines.reduce((sum, line) => sum + (line.kind === 'product'
    ? room.catalog.find(product => product.id === line.productId)!.unitCostPaise : line.unitCostPaise), 0);
  return room.catalog.filter((candidate) => {
    const proposedUnit = quote.unitTotalPaise + candidate.unitPricePaise;
    const proposedCost = currentCost + candidate.unitCostPaise;
    const marginBps = Math.floor(((proposedUnit - proposedCost) * 10_000) / proposedUnit);
    return (
      candidate.category === 'accessory' &&
      candidate.unitPricePaise > 0 &&
      !existingIds.has(candidate.id) &&
      satisfies(candidate.tags, room.deal.hardConstraints) &&
      candidate.availableQuantity >= room.deal.quantity &&
      candidate.leadTimeDays <= daysAvailable(room.deal.deadline, now) &&
      proposedUnit <= room.deal.maxUnitPaise &&
      marginBps >= room.policy.minimumMarginBps
    );
  }).sort((a, b) => b.unitPricePaise - a.unitPricePaise || a.id.localeCompare(b.id));
}

function upsellSuggestion(room: UpsellRoom, product: CatalogProduct) {
  const quote = room.currentQuote!;
  const unitTotalPaise = quote.unitTotalPaise + product.unitPricePaise;
  const orderTotalPaise = unitTotalPaise * quote.quantity;
  const incrementalRevenuePaise = product.unitPricePaise * quote.quantity;
  return {
    product: {
      id: product.id,
      sku: product.sku,
      name: product.name,
      unitPricePaise: product.unitPricePaise,
      leadTimeDays: product.leadTimeDays,
    },
    remainingBudgetPaise: room.deal.maxUnitPaise - quote.unitTotalPaise,
    originalOrderPaise: quote.orderTotalPaise,
    finalOrderPaise: orderTotalPaise,
    incrementalRevenuePaise,
    liftBps: Math.round((incrementalRevenuePaise * 10_000) / quote.orderTotalPaise),
    authority: 'DETERMINISTIC_ELIGIBILITY_CHECKS' as const,
  };
}

export async function findSafeUpsell(
  binding: D1Database,
  publicToken: string,
  now = new Date().toISOString(),
  apiKey?: string,
) {
  const room = await loadPublicDealRoom(binding, publicToken);
  if (!room) return null;
  const eligible = eligibleUpsellProducts(room, now).slice(0, 20);
  if (!eligible.length) return null;
  const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
  const candidates: RecommendationCandidate[] = eligible.map(product => ({ id: product.id, name: product.name, facts: [
    { id: 'price', text: `Adds ${money(product.unitPricePaise)} per kit.` },
    { id: 'headroom', text: `${money(room.deal.maxUnitPaise - room.currentQuote!.unitTotalPaise - product.unitPricePaise)} per kit would remain in your budget.` },
    { id: 'delivery', text: `Catalog lead time: ${product.leadTimeDays} days, within your requested date.` },
    { id: 'quantity', text: `Available for all ${room.deal.quantity} kits.` },
    ...(room.deal.hardConstraints.length ? [{ id: 'constraints', text: `Passes ${room.deal.hardConstraints.join(', ')} checks.` }] : []),
  ] }));
  const recommendation = await recordedRecommendation(binding, { dealId: room.deal.id, quoteId: room.currentQuote!.id,
    kind: 'upsell_selection', context: { ...recommendationContext(room), quoteHash: room.currentQuote!.quoteHash,
      existingProducts: room.currentQuote!.lines.filter(line => line.kind === 'product').map(line => line.label) }, candidates, apiKey });
  const selected = recommendation.ranking[0];
  const product = eligible.find(product => product.id === selected.id)!;
  return { ...upsellSuggestion(room, product), sourceQuoteHash: room.currentQuote!.quoteHash,
    hasUnverifiedPreferences: room.deal.customRequirements.some(requirement => requirement.priority === 'preferred'),
    recommendationSource: recommendation.source,
    explanation: recommendationExplanation(candidates.find(candidate => candidate.id === selected.id)!, selected.factIds) };
}

export async function acceptSafeUpsell(
  binding: D1Database,
  publicToken: string,
  expectedQuoteHash: string,
  selection: { productId: string; expectedUnitPricePaise: number },
  now = new Date().toISOString(),
) {
  const room = await loadPublicDealRoom(binding, publicToken);
  const source = room?.currentQuote;
  if (!room || !source) throw new QuoteWorkflowError('DEAL_NOT_FOUND', 'Deal unavailable.', 404);
  if (source.status !== 'merchant_approved' || source.quoteHash !== expectedQuoteHash) {
    throw new QuoteWorkflowError('QUOTE_CHANGED', 'The quote changed before the upsell was accepted.', 409);
  }
  // Never rerank at acceptance: the product and displayed price are expectations,
  // not authority. Match them against fresh deterministic eligibility and pricing.
  const product = eligibleUpsellProducts(room, now).find(product => product.id === selection.productId);
  if (!product || product.unitPricePaise !== selection.expectedUnitPricePaise) {
    throw new QuoteWorkflowError('UPSELL_UNAVAILABLE', 'This add-on or its price changed. Refresh and review it again.', 409);
  }
  const suggestion = upsellSuggestion(room, product);

  const line: QuoteLine = {
    code: suggestion.product.sku,
    label: suggestion.product.name,
    kind: 'product',
    productId: suggestion.product.id,
    unitPricePaise: suggestion.product.unitPricePaise,
    unitCostPaise: product.unitCostPaise,
  };
  const unitTotalPaise = source.unitTotalPaise + line.unitPricePaise;
  const sourceLines = source.lines.map(line => line.kind === 'product'
    ? { ...line, unitCostPaise: room.catalog.find(product => product.id === line.productId)!.unitCostPaise } : line);
  const unitCostPaise = sourceLines.reduce((sum, line) => sum + line.unitCostPaise, 0) + line.unitCostPaise;
  const contributionMarginBps = Math.floor(
    ((unitTotalPaise - unitCostPaise) * 10_000) / unitTotalPaise,
  );
  const checks: ConstraintCheck[] = [
    ...source.checks,
    { code: 'UPSELL_BUYER_BUDGET', passed: unitTotalPaise <= room.deal.maxUnitPaise, observed: String(unitTotalPaise), required: `<=${room.deal.maxUnitPaise}` },
    { code: 'UPSELL_INVENTORY_AVAILABLE', passed: true, observed: String(product.availableQuantity), required: `>=${source.quantity}` },
    { code: 'UPSELL_MARGIN_FLOOR', passed: contributionMarginBps >= room.policy.minimumMarginBps, observed: String(contributionMarginBps), required: `>=${room.policy.minimumMarginBps}` },
    { code: 'UPSELL_DELIVERY_FEASIBLE', passed: suggestion.product.leadTimeDays <= daysAvailable(room.deal.deadline, now), observed: `${suggestion.product.leadTimeDays}d`, required: `<=${daysAvailable(room.deal.deadline, now)}d` },
  ];
  const option: QuoteOption = {
    key: source.optionKey,
    label: `${source.label} + growth add-on`,
    rationale: `Added ${line.label} after budget, inventory, margin, delivery and buyer-constraint checks passed.`,
    lines: [...sourceLines, line],
    productUnitPaise: source.lines.filter((item) => item.kind === 'product').reduce((sum, item) => sum + item.unitPricePaise, 0) + line.unitPricePaise,
    serviceUnitPaise: source.lines.filter((item) => item.kind === 'service').reduce((sum, item) => sum + item.unitPricePaise, 0),
    unitTotalPaise,
    orderTotalPaise: unitTotalPaise * source.quantity,
    unitCostPaise,
    contributionMarginBps,
    headroomPaise: room.deal.maxUnitPaise - unitTotalPaise,
    checks,
  };
  const policyDecision = evaluateCommerceAction({
    action: 'approve_quote',
    policy: room.policy,
    now,
    buyerMaxUnitPaise: room.deal.maxUnitPaise,
    quote: {
      status: 'candidate',
      unitTotalPaise,
      contributionMarginBps,
      checks,
    },
  });
  if (!policyDecision.allowed) {
    throw new QuoteWorkflowError('UPSELL_POLICY_REJECTED', 'The upsell no longer passes merchant policy.', 409);
  }

  const version = (room.quoteHistory[0]?.version ?? 0) + 1;
  const expiresAt = new Date(Date.parse(now) + QUOTE_LIFETIME_MS).toISOString();
  const fingerprints = await createQuoteFingerprints({
    dealId: room.deal.id,
    intentId: room.deal.intentId,
    version,
    quantity: room.deal.quantity,
    maxUnitPaise: room.deal.maxUnitPaise,
    deliveryLocations: room.deal.deliveryLocations,
    deadline: room.deal.deadline,
    hardConstraints: room.deal.hardConstraints,
    policyVersion: room.policy.version,
    option,
    expiresAt,
  });
  const quoteId = crypto.randomUUID();
  const audit = await prepareAuditBatch(binding, room.deal.id, [
    {
      id: crypto.randomUUID(),
      quoteId,
      eventType: 'constraint_safe_upsell_accepted',
      actorType: 'buyer',
      summary: `Add-on selected — ₹${(suggestion.incrementalRevenuePaise / 100).toLocaleString('en-IN')} added to the offer, awaiting payment.`,
      data: {
        productId: suggestion.product.id,
        originalOrderPaise: suggestion.originalOrderPaise,
        finalOrderPaise: suggestion.finalOrderPaise,
        incrementalRevenuePaise: suggestion.incrementalRevenuePaise,
        liftBps: suggestion.liftBps,
        policyVersion: room.policy.version,
      },
      createdAt: now,
    },
  ]);

  await binding.batch([
    quoteAuthorityGuard(binding, { merchantId: room.deal.merchantId, policyVersion: room.policy.version,
      quantity: source.quantity, catalog: room.catalog, option, now }),
    // The NOT NULL deal_id constraint aborts the whole batch if acceptance or
    // another quote change won the race after our initial read.
    binding.prepare(`UPDATE quotes SET status = 'superseded',
      deal_id = CASE WHEN status = 'merchant_approved' AND quote_hash = ? THEN deal_id ELSE NULL END
      WHERE id = ?`).bind(expectedQuoteHash, source.id),
    binding
      .prepare(
        `INSERT INTO quotes (
          id, deal_id, version, option_key, label, rationale, lines_json, checks_json,
          quantity, unit_total_paise, order_total_paise, unit_cost_paise,
          contribution_margin_bps, policy_version, intent_hash, quote_hash, status,
          expires_at, created_at, approved_at, accepted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'merchant_approved', ?, ?, ?, NULL)`,
      )
      .bind(
        quoteId, room.deal.id, version, option.key, option.label, option.rationale,
        JSON.stringify(option.lines), JSON.stringify(option.checks), source.quantity,
        option.unitTotalPaise, option.orderTotalPaise, option.unitCostPaise,
        option.contributionMarginBps, room.policy.version, fingerprints.intentHash,
        fingerprints.quoteHash, expiresAt, now, now,
      ),
    ...audit.statements,
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, room.deal.id),
  ]);
  return { quoteHash: fingerprints.quoteHash, suggestion };
}

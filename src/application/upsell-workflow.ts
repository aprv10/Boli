import { createQuoteFingerprints } from '@/src/domain/quoting/executable-quote';
import type { ConstraintCheck, HardConstraint, QuoteLine, QuoteOption } from '@/src/domain/quoting/types';
import { evaluateCommerceAction } from '@/src/domain/policies/commerce-policy';
import { prepareAuditBatch } from './audit-ledger';
import { loadPublicDealRoom, QuoteWorkflowError } from './quote-workflow';

const QUOTE_LIFETIME_MS = 48 * 60 * 60 * 1_000;

type UpsellProduct = {
  id: string;
  sku: string;
  name: string;
  tagsJson: string;
  unitPricePaise: number;
  unitCostPaise: number;
  availableQuantity: number;
  reservedQuantity: number;
  leadTimeDays: number;
};

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

export async function findSafeUpsell(
  binding: D1Database,
  publicToken: string,
  now = new Date().toISOString(),
) {
  const room = await loadPublicDealRoom(binding, publicToken);
  const quote = room?.currentQuote;
  if (!room || !quote || quote.status !== 'merchant_approved') return null;
  if (room.deal.selection?.mode === 'product') return null;
  const existingIds = new Set(quote.lines.map(line => line.productId));

  const rows = await binding
    .prepare(
      `SELECT id, sku, name, tags_json AS tagsJson, unit_price_paise AS unitPricePaise,
        unit_cost_paise AS unitCostPaise, available_quantity AS availableQuantity,
        reserved_quantity AS reservedQuantity, lead_time_days AS leadTimeDays
       FROM products WHERE merchant_id = ? AND category = 'accessory' AND active = 1
       ORDER BY unit_price_paise DESC`,
    )
    .bind(room.deal.merchantId)
    .all<UpsellProduct>();

  const product = rows.results.find((candidate) => {
    const tags = JSON.parse(candidate.tagsJson) as string[];
    const proposedUnit = quote.unitTotalPaise + candidate.unitPricePaise;
    const proposedCost = quote.unitCostPaise + candidate.unitCostPaise;
    const marginBps = Math.floor(((proposedUnit - proposedCost) * 10_000) / proposedUnit);
    return (
      !existingIds.has(candidate.id) &&
      satisfies(tags, room.deal.hardConstraints) &&
      candidate.availableQuantity - candidate.reservedQuantity >= room.deal.quantity &&
      candidate.leadTimeDays <= daysAvailable(room.deal.deadline, now) &&
      proposedUnit <= room.deal.maxUnitPaise &&
      marginBps >= room.policy.minimumMarginBps
    );
  });
  if (!product) return null;

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

export async function acceptSafeUpsell(
  binding: D1Database,
  publicToken: string,
  expectedQuoteHash: string,
  now = new Date().toISOString(),
) {
  const room = await loadPublicDealRoom(binding, publicToken);
  const source = room?.currentQuote;
  if (!room || !source) throw new QuoteWorkflowError('DEAL_NOT_FOUND', 'Deal unavailable.', 404);
  if (source.status !== 'merchant_approved' || source.quoteHash !== expectedQuoteHash) {
    throw new QuoteWorkflowError('QUOTE_CHANGED', 'The quote changed before the upsell was accepted.', 409);
  }
  const suggestion = await findSafeUpsell(binding, publicToken, now);
  if (!suggestion) {
    throw new QuoteWorkflowError('UPSELL_UNAVAILABLE', 'No constraint-safe upsell is currently available.', 409);
  }
  const product = await binding
    .prepare(
      `SELECT unit_cost_paise AS unitCostPaise, available_quantity AS availableQuantity,
        reserved_quantity AS reservedQuantity FROM products WHERE id = ? AND active = 1`,
    )
    .bind(suggestion.product.id)
    .first<{ unitCostPaise: number; availableQuantity: number; reservedQuantity: number }>();
  if (!product || product.availableQuantity - product.reservedQuantity < source.quantity) {
    throw new QuoteWorkflowError('UPSELL_INVENTORY_CHANGED', 'Upsell inventory changed before approval.', 409);
  }

  const line: QuoteLine = {
    code: suggestion.product.sku,
    label: suggestion.product.name,
    kind: 'product',
    productId: suggestion.product.id,
    unitPricePaise: suggestion.product.unitPricePaise,
    unitCostPaise: product.unitCostPaise,
  };
  const unitTotalPaise = source.unitTotalPaise + line.unitPricePaise;
  const unitCostPaise = source.unitCostPaise + line.unitCostPaise;
  const contributionMarginBps = Math.floor(
    ((unitTotalPaise - unitCostPaise) * 10_000) / unitTotalPaise,
  );
  const checks: ConstraintCheck[] = [
    ...source.checks,
    { code: 'UPSELL_BUYER_BUDGET', passed: unitTotalPaise <= room.deal.maxUnitPaise, observed: String(unitTotalPaise), required: `<=${room.deal.maxUnitPaise}` },
    { code: 'UPSELL_INVENTORY_AVAILABLE', passed: true, observed: String(product.availableQuantity - product.reservedQuantity), required: `>=${source.quantity}` },
    { code: 'UPSELL_MARGIN_FLOOR', passed: contributionMarginBps >= room.policy.minimumMarginBps, observed: String(contributionMarginBps), required: `>=${room.policy.minimumMarginBps}` },
    { code: 'UPSELL_DELIVERY_FEASIBLE', passed: suggestion.product.leadTimeDays <= daysAvailable(room.deal.deadline, now), observed: `${suggestion.product.leadTimeDays}d`, required: `<=${daysAvailable(room.deal.deadline, now)}d` },
  ];
  const option: QuoteOption = {
    key: source.optionKey,
    label: `${source.label} + growth add-on`,
    rationale: `Added ${line.label} after budget, inventory, margin, delivery and buyer-constraint checks passed.`,
    lines: [...source.lines, line],
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

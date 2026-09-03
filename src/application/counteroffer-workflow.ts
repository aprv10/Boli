import { desc, eq } from 'drizzle-orm';
import { counteroffers } from '@/db/schema';
import { getDatabase } from '@/src/adapters/db/database';
import {
  evaluateBoundedCounteroffer,
  type CounterofferDecision,
} from '@/src/domain/negotiation/bounded-counteroffer';
import { evaluateCommerceAction } from '@/src/domain/policies/commerce-policy';
import { createQuoteFingerprints } from '@/src/domain/quoting/executable-quote';
import { generateCorporateGiftingQuotes } from '@/src/domain/quoting/corporate-gifting-engine';
import type { ConstraintCheck, QuoteOption, QuoteEngineResult } from '@/src/domain/quoting/types';
import {
  loadDealQuotes,
  loadPublicDealRoom,
  QuoteWorkflowError,
  type StoredQuote,
} from './quote-workflow';
import { prepareAuditBatch } from './audit-ledger';
import { requiresMerchantReview } from '@/src/domain/quoting/custom-requirements';
import { quoteAuthorityGuard } from './quote-authority-guard';

const QUOTE_LIFETIME_MS = 48 * 60 * 60 * 1_000;

export type StoredCounteroffer = {
  id: string;
  dealId: string;
  sourceQuoteId: string;
  proposedQuoteId: string | null;
  buyerChoice: 'pending' | 'revised' | 'original' | null;
  sourceKind: 'structured' | 'natural_language';
  buyerMessage: string;
  targetUnitPaise: number;
  status:
    | 'auto_approved'
    | 'bounded_counteroffer'
    | 'merchant_approval_required'
    | 'merchant_approved'
    | 'rejected';
  proposedOption: QuoteOption | null;
  checks: ConstraintCheck[];
  reasonCodes: string[];
  decisionSummary: string;
  createdAt: string;
  decidedAt: string | null;
};

function parseCounteroffer(
  row: typeof counteroffers.$inferSelect,
): StoredCounteroffer {
  return {
    id: row.id,
    dealId: row.dealId,
    sourceQuoteId: row.sourceQuoteId,
    proposedQuoteId: row.proposedQuoteId,
    buyerChoice: row.buyerChoice,
    sourceKind: row.sourceKind,
    buyerMessage: row.buyerMessage,
    targetUnitPaise: row.targetUnitPaise,
    status: row.status,
    proposedOption: row.proposedOptionJson
      ? (JSON.parse(row.proposedOptionJson) as QuoteOption)
      : null,
    checks: JSON.parse(row.checksJson) as ConstraintCheck[],
    reasonCodes: JSON.parse(row.reasonCodesJson) as string[],
    decisionSummary: row.decisionSummary,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

export async function loadDealCounteroffers(
  binding: D1Database,
  dealId: string,
) {
  const rows = await getDatabase(binding)
    .select()
    .from(counteroffers)
    .where(eq(counteroffers.dealId, dealId))
    .orderBy(desc(counteroffers.createdAt));
  return rows.map(parseCounteroffer);
}

function negotiatedOption(
  decision: CounterofferDecision,
  approval: 'automatic' | 'merchant',
): QuoteOption {
  const option = decision.proposedOption!;
  const label = decision.targetMet ? 'Target matched' : 'Closest available price';
  const checksByCode = new Map(
    [...option.checks, ...decision.checks].map((check) => [check.code, check]),
  );
  return {
    ...option,
    label,
    rationale: `${decision.summary} ${
      approval === 'automatic'
        ? 'Issued inside the merchant’s automatic negotiation authority.'
        : 'Issued after explicit merchant approval.'
    }`,
    checks: [...checksByCode.values()],
  };
}

async function prepareQuoteVersion(
  room: NonNullable<Awaited<ReturnType<typeof loadPublicDealRoom>>>,
  option: QuoteOption,
  now: string,
) {
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
  return {
    id: crypto.randomUUID(),
    version,
    policyVersion: room.policy.version,
    expiresAt,
    ...fingerprints,
  };
}

function quoteInsert(
  binding: D1Database,
  dealId: string,
  quote: Awaited<ReturnType<typeof prepareQuoteVersion>>,
  option: QuoteOption,
  quantity: number,
  now: string,
) {
  return binding
    .prepare(
      `INSERT INTO quotes (
        id, deal_id, version, option_key, label, rationale, lines_json,
        checks_json, quantity, unit_total_paise, order_total_paise,
        unit_cost_paise, contribution_margin_bps, policy_version, intent_hash, quote_hash,
        status, expires_at, created_at, approved_at, accepted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'merchant_approved', ?, ?, ?, NULL)`,
    )
    .bind(
      quote.id,
      dealId,
      quote.version,
      option.key,
      option.label,
      option.rationale,
      JSON.stringify(option.lines),
      JSON.stringify(option.checks),
      quantity,
      option.unitTotalPaise,
      option.orderTotalPaise,
      option.unitCostPaise,
      option.contributionMarginBps,
      quote.policyVersion,
      quote.intentHash,
      quote.quoteHash,
      quote.expiresAt,
      now,
      now,
    );
}

export async function submitBoundedCounteroffer(
  binding: D1Database,
  publicToken: string,
  input: {
    expectedQuoteHash: string;
    targetUnitPaise: number;
    buyerMessage: string;
    sourceKind?: 'structured' | 'natural_language';
    awaitBuyerChoice?: boolean;
    allowAlternatives?: boolean;
  },
  now = new Date().toISOString(),
) {
  const room = await loadPublicDealRoom(binding, publicToken);
  if (!room) {
    throw new QuoteWorkflowError('DEAL_NOT_FOUND', 'This Deal Room does not exist.', 404);
  }
  const sourceQuote = room.currentQuote;
  if (requiresMerchantReview(room.deal.customRequirements)) throw new QuoteWorkflowError('CUSTOM_ORDER_LOCKED', 'The store confirmed specific items and conditions for this offer. Automatic changes are unavailable; start a revised request to change it.', 409);
  if ((await loadDealCounteroffers(binding, room.deal.id)).length) {
    throw new QuoteWorkflowError('NEGOTIATION_COMPLETE', 'This request has already been reviewed. You can accept the current offer or start a new buying request.', 409);
  }
  if (!sourceQuote || sourceQuote.status !== 'merchant_approved') {
    throw new QuoteWorkflowError(
      'QUOTE_NOT_NEGOTIABLE',
      'Only a current merchant-approved quote can be negotiated.',
      409,
    );
  }
  if (sourceQuote.quoteHash !== input.expectedQuoteHash) {
    throw new QuoteWorkflowError(
      'QUOTE_CHANGED',
      'The quote changed before this proposal was evaluated. Refresh and try again.',
      409,
    );
  }
  if (Date.parse(sourceQuote.expiresAt) <= Date.parse(now)) {
    throw new QuoteWorkflowError('QUOTE_EXPIRED', 'This quote has expired.', 410);
  }
  if (!Number.isSafeInteger(input.targetUnitPaise) || input.targetUnitPaise < 100 || input.targetUnitPaise >= sourceQuote.unitTotalPaise) {
    throw new QuoteWorkflowError('TARGET_NOT_LOWER', 'Enter one target below the current price per item. Your negotiation round has not been used.', 422);
  }

  let targetResult = generateCorporateGiftingQuotes(room.catalog, {
    selection: room.deal.selection,
    quantity: room.deal.quantity,
    maxUnitPaise: Math.min(input.targetUnitPaise, room.deal.maxUnitPaise),
    deliveryLocations: room.deal.deliveryLocations,
    deadline: room.deal.deadline,
    hardConstraints: room.deal.hardConstraints,
    minimumMarginBps: room.policy.minimumMarginBps,
    now,
  });
  // A real discount on unchanged items is derived from current costs and the
  // margin floor. The language model supplies only the requested ceiling.
  const productLines = sourceQuote.lines.filter(line => line.kind === 'product');
  const liveProducts = productLines.map(line => room.catalog.find(product => product.id === line.productId));
  const availableDays = Math.max(0, Math.ceil((Date.parse(`${room.deal.deadline}T23:59:59Z`) - Date.parse(now)) / 86_400_000));
  let baselineResult = room.result;
  if (liveProducts.length && liveProducts.every(product => product && product.availableQuantity >= sourceQuote.quantity && product.leadTimeDays <= availableDays)) {
    const lines = sourceQuote.lines.map(line => ({ ...line, unitCostPaise: line.kind === 'product' ? room.catalog.find(product => product.id === line.productId)!.unitCostPaise : line.unitCostPaise }));
    const cost = lines.reduce((sum, line) => sum + line.unitCostPaise, 0);
    const floor = Math.ceil(cost * 10_000 / (10_000 - room.policy.minimumMarginBps));
    const discountedTotal = Math.max(input.targetUnitPaise, floor);
    if (discountedTotal > 0 && discountedTotal < sourceQuote.unitTotalPaise && discountedTotal <= room.deal.maxUnitPaise) {
      const discount = sourceQuote.unitTotalPaise - discountedTotal;
      const margin = Math.floor((discountedTotal - cost) * 10_000 / discountedTotal);
      const option: QuoteOption = {
        key: sourceQuote.optionKey, label: 'Same items, lower price', rationale: 'Same products with a discount calculated from current costs and the merchant’s minimum margin.',
        lines: [...lines, { code: 'negotiated-discount', label: 'Order discount', kind: 'service', unitPricePaise: -discount, unitCostPaise: 0 }],
        productUnitPaise: productLines.reduce((sum, line) => sum + line.unitPricePaise, 0),
        serviceUnitPaise: lines.filter(line => line.kind === 'service').reduce((sum, line) => sum + line.unitPricePaise, 0) - discount,
        unitTotalPaise: discountedTotal, orderTotalPaise: discountedTotal * sourceQuote.quantity,
        unitCostPaise: cost, contributionMarginBps: margin, headroomPaise: room.deal.maxUnitPaise - discountedTotal,
        checks: sourceQuote.checks.map(check => check.code === 'MERCHANT_MARGIN_FLOOR' ? { ...check, passed: margin >= room.policy.minimumMarginBps, observed: String(margin), required: `>=${room.policy.minimumMarginBps}` } : check.code === 'BUYER_UNIT_BUDGET' ? { ...check, observed: String(discountedTotal) } : check),
      };
      const appendOption = (result: QuoteEngineResult): QuoteEngineResult => ({ status: 'generated', options: [...(result.status === 'generated' ? result.options : []), option], evaluatedCombinations: result.evaluatedCombinations + 1, feasibleCombinations: (result.status === 'generated' ? result.feasibleCombinations : 0) + 1 });
      baselineResult = appendOption(baselineResult);
      if (discountedTotal <= input.targetUnitPaise) targetResult = { status: 'generated', options: [option], evaluatedCombinations: 1, feasibleCombinations: 1 };
    }
  }
  const decision = evaluateBoundedCounteroffer({
    sourceQuote,
    targetUnitPaise: input.targetUnitPaise,
    originalMaxUnitPaise: room.deal.maxUnitPaise,
    hardConstraints: room.deal.hardConstraints,
    targetResult,
    baselineResult,
    allowAlternatives: input.allowAlternatives,
    policy: room.policy,
  });
  const policyDecision = decision.proposedOption
    ? evaluateCommerceAction({
        action: 'auto_issue_counteroffer',
        policy: room.policy,
        now,
        buyerMaxUnitPaise: room.deal.maxUnitPaise,
        concessionBps: decision.concessionBps,
        quote: {
          status: 'candidate',
          unitTotalPaise: decision.proposedOption.unitTotalPaise,
          contributionMarginBps: decision.proposedOption.contributionMarginBps,
          checks: decision.proposedOption.checks,
        },
      })
    : null;
  const effectiveStatus = !policyDecision
    ? decision.status
    : policyDecision.allowed
      ? decision.status
      : policyDecision.approvalRequired
        ? 'merchant_approval_required'
        : 'rejected';
  const combinedChecks = new Map(
    [...decision.checks, ...(policyDecision?.checks ?? [])].map((check) => [check.code, check]),
  );
  const finalDecision: CounterofferDecision = {
    ...decision,
    status: effectiveStatus,
    checks: [...combinedChecks.values()],
    reasonCodes: [...new Set([...decision.reasonCodes, ...(policyDecision?.reasonCodes ?? [])])],
  };
  const counterofferId = crypto.randomUUID();
  const automaticallyIssued =
    finalDecision.status === 'auto_approved' ||
    finalDecision.status === 'bounded_counteroffer';
  const option = automaticallyIssued
    ? refreshNegotiatedOption(room, negotiatedOption(finalDecision, 'automatic'), now)
    : finalDecision.proposedOption;
  const preparedQuote = automaticallyIssued && option && !input.awaitBuyerChoice
    ? await prepareQuoteVersion(room, option, now)
    : null;
  const decidedAt =
    finalDecision.status === 'merchant_approval_required' ? null : now;

  const auditDrafts = [
    {
      id: crypto.randomUUID(),
      quoteId: null,
      eventType: 'counteroffer_submitted',
      actorType: 'buyer' as const,
      summary: `Buyer requested ${input.targetUnitPaise / 100} INR per unit against quote v${sourceQuote.version}.`,
      data: {
        counterofferId,
        sourceQuoteHash: sourceQuote.quoteHash,
        targetUnitPaise: input.targetUnitPaise,
        allowAlternatives: input.allowAlternatives ?? true,
        awaitBuyerChoice: input.awaitBuyerChoice ?? false,
      },
      createdAt: now,
    },
    {
      id: crypto.randomUUID(),
      quoteId: null,
      eventType: 'counteroffer_evaluated',
      actorType: 'system' as const,
      summary: finalDecision.summary,
      data: {
        counterofferId,
        status: finalDecision.status,
        checks: finalDecision.checks,
        reasonCodes: finalDecision.reasonCodes,
        proposedUnitPaise: finalDecision.proposedUnitPaise,
        policyVersion: room.policy.version,
      },
      createdAt: now,
    },
    ...(preparedQuote
      ? [{
          id: crypto.randomUUID(),
          quoteId: preparedQuote.id,
          eventType: 'quote_approved',
          actorType: 'system' as const,
          summary: `Boli issued negotiated quote v${preparedQuote.version} inside automatic authority.`,
          data: {
            counterofferId,
            quoteHash: preparedQuote.quoteHash,
            policyVersion: room.policy.version,
            checks: policyDecision?.checks ?? [],
            reasonCodes: policyDecision?.reasonCodes ?? [],
          },
          createdAt: now,
        }]
      : []),
  ];
  const audit = await prepareAuditBatch(binding, room.deal.id, auditDrafts);

  const statements: D1PreparedStatement[] = [
    ...(option ? [quoteAuthorityGuard(binding, { merchantId: room.deal.merchantId, policyVersion: room.policy.version, quantity: room.deal.quantity, catalog: room.catalog, option, now })] : []),
    binding.prepare(`INSERT INTO negotiation_rounds (deal_id, source_quote_id, created_at)
      VALUES (?, (SELECT id FROM quotes WHERE id = ? AND quote_hash = ? AND status = 'merchant_approved' AND expires_at > ?), ?)`)
      .bind(room.deal.id, sourceQuote.id, input.expectedQuoteHash, now, now),
    binding
      .prepare(
        `INSERT INTO counteroffers (
          id, deal_id, source_quote_id, proposed_quote_id, source_kind,
          buyer_message, target_unit_paise, status, proposed_option_json,
          checks_json, reason_codes_json, decision_summary, created_at, decided_at, buyer_choice
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        counterofferId,
        room.deal.id,
        sourceQuote.id,
        null,
        input.sourceKind ?? 'structured',
        input.buyerMessage,
        input.targetUnitPaise,
        finalDecision.status,
        option ? JSON.stringify(option) : null,
        JSON.stringify(finalDecision.checks),
        JSON.stringify(finalDecision.reasonCodes),
        finalDecision.summary,
        now,
        decidedAt,
        input.awaitBuyerChoice && finalDecision.status !== 'rejected' ? 'pending' : null,
      ),
  ];

  if (preparedQuote && option) {
    statements.push(
      binding
        .prepare(
          `UPDATE quotes SET status = 'superseded'
           WHERE id = ? AND status = 'merchant_approved' AND quote_hash = ?`,
        )
        .bind(sourceQuote.id, input.expectedQuoteHash),
      quoteInsert(
        binding,
        room.deal.id,
        preparedQuote,
        option,
        room.deal.quantity,
        now,
      ),
      binding
        .prepare(
          `UPDATE counteroffers SET proposed_quote_id = ? WHERE id = ?`,
        )
        .bind(preparedQuote.id, counterofferId),
    );
  }
  statements.push(
    ...audit.statements,
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, room.deal.id),
  );
  try {
    await binding.batch(statements);
  } catch (error) {
    if (/constraint|unique/i.test(String(error))) throw new QuoteWorkflowError('QUOTE_CHANGED', 'This request was already reviewed or the offer changed. Refresh to see the latest result.', 409);
    throw error;
  }

  const stored = (await loadDealCounteroffers(binding, room.deal.id)).find(
    (item) => item.id === counterofferId,
  )!;
  const quote = preparedQuote
    ? (await loadDealQuotes(binding, room.deal.id)).find(
        (item) => item.id === preparedQuote.id,
      ) ?? null
    : null;
  return { counteroffer: stored, quote };
}

// A proposal is not a reservation. Re-check its exact products and current costs
// before either a merchant or buyer can turn it into an executable quote.
function refreshNegotiatedOption(room: NonNullable<Awaited<ReturnType<typeof loadPublicDealRoom>>>, option: QuoteOption, now: string): QuoteOption {
  const days = Math.ceil((Date.parse(`${room.deal.deadline}T23:59:59Z`) - Date.parse(now)) / 86_400_000);
  const items = option.lines.filter(line => line.kind === 'product').map(line => room.catalog.find(product => product.id === line.productId));
  if (!items.length || items.some(product => !product || product.availableQuantity < room.deal.quantity || product.leadTimeDays > days)) {
    throw new QuoteWorkflowError('PROPOSAL_UNAVAILABLE', 'The proposed products no longer meet stock or delivery requirements. Your current offer has not changed.', 409);
  }
  const validItems = items.map(item => item!);
  if (validItems.some(item => (room.deal.hardConstraints.includes('vegan') && !item.tags.includes('vegan')) || (room.deal.hardConstraints.includes('plastic-free') && !item.tags.includes('plastic-free'))) ||
    (room.deal.hardConstraints.includes('branded') && validItems.filter(item => item.tags.includes('brandable')).length < (room.deal.selection?.mode === 'product' ? 1 : 2))) {
    throw new QuoteWorkflowError('CONSTRAINT_CHANGED', 'A proposed product no longer meets your requirements. Your current offer has not changed.', 409);
  }
  const lines = option.lines.map(line => ({ ...line, unitCostPaise: line.kind === 'product' ? validItems.find(item => item.id === line.productId)!.unitCostPaise : line.unitCostPaise }));
  const cost = lines.reduce((sum, line) => sum + line.unitCostPaise, 0);
  const total = lines.reduce((sum, line) => sum + line.unitPricePaise, 0);
  const margin = Math.floor((total - cost) * 10_000 / total);
  if (total !== option.unitTotalPaise || total * room.deal.quantity !== option.orderTotalPaise || total <= 0 || total > room.deal.maxUnitPaise || margin < room.policy.minimumMarginBps) {
    throw new QuoteWorkflowError('PROPOSAL_POLICY_CHANGED', 'Current costs or store rules no longer allow this price. Your current offer has not changed.', 409);
  }
  const checks = new Map(option.checks.map(check => [check.code, check]));
  if (room.deal.customRequirements.length) checks.set('CUSTOM_PREFERENCES_RECORDED', { code: 'CUSTOM_PREFERENCES_RECORDED', passed: true, observed: JSON.stringify(room.deal.customRequirements), required: 'Preferences only; not guaranteed' });
  for (const check of [
    { code: 'MERCHANT_MARGIN_FLOOR', passed: true, observed: String(margin), required: `>=${room.policy.minimumMarginBps}` },
    { code: 'INVENTORY_AVAILABLE', passed: true, observed: String(Math.min(...validItems.map(item => item.availableQuantity))), required: `>=${room.deal.quantity}` },
    { code: 'LEAD_TIME_FEASIBLE', passed: true, observed: `${Math.max(...validItems.map(item => item.leadTimeDays))}d`, required: `<=${days}d` },
  ]) checks.set(check.code, check);
  return { ...option, lines, unitCostPaise: cost, contributionMarginBps: margin, checks: [...checks.values()] };
}

export async function chooseCounteroffer(binding: D1Database, publicToken: string, input: { counterofferId: string; expectedQuoteHash: string; choice: 'original' | 'revised' }, now = new Date().toISOString()) {
  const room = await loadPublicDealRoom(binding, publicToken);
  if (!room) throw new QuoteWorkflowError('NOT_FOUND', 'This order was not found.', 404);
  const proposal = (await loadDealCounteroffers(binding, room.deal.id)).find(item => item.id === input.counterofferId);
  if (!proposal) throw new QuoteWorkflowError('NOT_FOUND', 'This price request was not found.', 404);
  if (proposal.buyerChoice === input.choice) return { saved: true, reused: true };
  const source = room.currentQuote;
  if (proposal.buyerChoice !== 'pending' || !source || source.id !== proposal.sourceQuoteId || source.quoteHash !== input.expectedQuoteHash || source.status !== 'merchant_approved' || Date.parse(source.expiresAt) <= Date.parse(now)) {
    throw new QuoteWorkflowError('OFFER_CHANGED', 'This offer changed or expired. Refresh to review the current order.', 409);
  }
  let option: QuoteOption | null = null;
  if (input.choice === 'revised') {
    if (!proposal.proposedOption || !['auto_approved','bounded_counteroffer','merchant_approved'].includes(proposal.status)) throw new QuoteWorkflowError('APPROVAL_REQUIRED', 'The store must approve this proposal first.', 409);
    option = refreshNegotiatedOption(room, proposal.proposedOption, now);
    const decision = evaluateCommerceAction({ action: proposal.status === 'merchant_approved' ? 'merchant_approve_counteroffer' : 'auto_issue_counteroffer', policy: room.policy, now,
      buyerMaxUnitPaise: room.deal.maxUnitPaise, concessionBps: Math.ceil((source.unitTotalPaise - option.unitTotalPaise) * 10_000 / source.unitTotalPaise),
      quote: { status: 'candidate', ...option } });
    if (!decision.allowed) throw new QuoteWorkflowError('RULES_CHANGED', 'The store’s current rules no longer authorize this proposal. Your original offer is unchanged.', 409);
    option = { ...option, checks: [...new Map([...option.checks, ...decision.checks].map(check => [check.code, check])).values()] };
  }
  const prepared = option ? await prepareQuoteVersion(room, option, now) : null;
  const audit = await prepareAuditBatch(binding, room.deal.id, [{ id: crypto.randomUUID(), quoteId: prepared?.id ?? source.id,
    eventType: input.choice === 'revised' ? 'counteroffer_selected' : 'counteroffer_kept_original', actorType: 'buyer',
    summary: input.choice === 'revised' ? 'Buyer chose the revised items and price. Payment approval is still required.' : 'Buyer kept the original offer; the price request is closed.',
    data: { counterofferId: proposal.id, sourceQuoteHash: source.quoteHash, quoteHash: prepared?.quoteHash ?? source.quoteHash, policyVersion: room.policy.version, checks: option?.checks ?? [] }, createdAt: now }]);
  const statements = [binding.prepare(`INSERT INTO merchant_changes (id,merchant_id,kind,before_json,after_json,created_at)
    VALUES (?,?,'buyer_offer_choice',(SELECT json_object('proposal',c.id) FROM counteroffers c JOIN quotes q ON q.id=c.source_quote_id
      WHERE c.id=? AND c.buyer_choice='pending' AND c.status=? AND q.quote_hash=? AND q.status='merchant_approved' AND q.expires_at>?),?,?)`)
    .bind(crypto.randomUUID(), room.deal.merchantId, proposal.id, proposal.status, source.quoteHash, now, JSON.stringify({ choice: input.choice }), now)];
  if (prepared && option) statements.push(
    quoteAuthorityGuard(binding, { merchantId: room.deal.merchantId, policyVersion: room.policy.version, quantity: room.deal.quantity, catalog: room.catalog, option, now }),
    binding.prepare("UPDATE quotes SET status='superseded' WHERE id=? AND status='merchant_approved'").bind(source.id),
    quoteInsert(binding, room.deal.id, prepared, option, room.deal.quantity, now),
  );
  statements.push(binding.prepare("UPDATE counteroffers SET buyer_choice=?,proposed_quote_id=? WHERE id=? AND buyer_choice='pending'").bind(input.choice, prepared?.id ?? null, proposal.id), ...audit.statements,
    binding.prepare('UPDATE deals SET updated_at=? WHERE id=?').bind(now, room.deal.id));
  try { await binding.batch(statements); } catch (error) {
    if (/constraint|unique/i.test(String(error))) throw new QuoteWorkflowError('OFFER_CHANGED', 'The order changed before your choice was saved. Refresh to see the latest offer.', 409);
    throw error;
  }
  return { saved: true, reused: false };
}

export async function approvePendingCounteroffer(
  binding: D1Database,
  dealId: string,
  counterofferId: string,
  now = new Date().toISOString(),
) {
  const room = await loadPublicDealRoomByDeal(binding, dealId);
  if (!room) {
    throw new QuoteWorkflowError('DEAL_NOT_FOUND', 'This deal does not exist.', 404);
  }
  const proposal = (await loadDealCounteroffers(binding, dealId)).find(
    (item) => item.id === counterofferId,
  );
  if (!proposal) {
    throw new QuoteWorkflowError('COUNTEROFFER_NOT_FOUND', 'That counteroffer does not exist.', 404);
  }
  if (proposal.status === 'merchant_approved' && proposal.proposedQuoteId) {
    const reused = room.quoteHistory.find((quote) => quote.id === proposal.proposedQuoteId);
    if (reused) return { counteroffer: proposal, quote: reused, reused: true };
  }
  if (proposal.status === 'merchant_approved' && proposal.buyerChoice === 'pending') return { counteroffer: proposal, quote: null, reused: true };
  if (
    proposal.status !== 'merchant_approval_required' ||
    !proposal.proposedOption || proposal.buyerChoice === 'original'
  ) {
    throw new QuoteWorkflowError(
      'COUNTEROFFER_NOT_APPROVABLE',
      'This counteroffer is not waiting for merchant approval.',
      409,
    );
  }
  const sourceQuote = room.currentQuote;
  if (
    !sourceQuote ||
    sourceQuote.id !== proposal.sourceQuoteId ||
    sourceQuote.status !== 'merchant_approved' || Date.parse(sourceQuote.expiresAt) <= Date.parse(now)
  ) {
    throw new QuoteWorkflowError(
      'SOURCE_QUOTE_CHANGED',
      'The executable quote changed, so this approval request is stale.',
      409,
    );
  }

  const decision: CounterofferDecision = {
    status: 'merchant_approval_required',
    proposedOption: proposal.proposedOption,
    targetUnitPaise: proposal.targetUnitPaise,
    proposedUnitPaise: proposal.proposedOption.unitTotalPaise,
    targetMet: proposal.proposedOption.unitTotalPaise <= proposal.targetUnitPaise,
    concessionBps: Math.ceil(
      ((sourceQuote.unitTotalPaise - proposal.proposedOption.unitTotalPaise) * 10_000) /
        sourceQuote.unitTotalPaise,
    ),
    checks: proposal.checks,
    reasonCodes: proposal.reasonCodes,
    summary: proposal.decisionSummary,
  };
  const option = refreshNegotiatedOption(room, negotiatedOption(decision, 'merchant'), now);
  const policyDecision = evaluateCommerceAction({
    action: 'merchant_approve_counteroffer',
    policy: room.policy,
    now,
    buyerMaxUnitPaise: room.deal.maxUnitPaise,
    quote: {
      status: 'candidate',
      unitTotalPaise: option.unitTotalPaise,
      contributionMarginBps: option.contributionMarginBps,
      checks: option.checks,
    },
  });
  if (!policyDecision.allowed) {
    throw new QuoteWorkflowError(
      'POLICY_REJECTED',
      `The proposed counteroffer failed policy: ${policyDecision.reasonCodes.join(', ')}.`,
      409,
    );
  }
  const approvedChecks = new Map(
    [...option.checks, ...policyDecision.checks].map((check) => [check.code, check]),
  );
  const approvedSummary = decision.targetMet
    ? 'The store approved your target price. Review the revised items and total before choosing the offer.'
    : 'The store approved a lower offer above your target. Review the revised items and total before choosing the offer.';
  const approvedOption = { ...option, rationale: approvedSummary, checks: [...approvedChecks.values()] };
  if (proposal.buyerChoice === 'pending') {
    const audit = await prepareAuditBatch(binding, dealId, [{ id: crypto.randomUUID(), quoteId: sourceQuote.id,
      eventType: 'counteroffer_approved', actorType: 'merchant', summary: 'The store approved a revised offer. The buyer must choose it before the order changes.',
      data: { counterofferId, sourceQuoteHash: sourceQuote.quoteHash, checks: policyDecision.checks, policyVersion: room.policy.version }, createdAt: now }]);
    await binding.batch([
      quoteAuthorityGuard(binding, { merchantId: room.deal.merchantId, policyVersion: room.policy.version, quantity: room.deal.quantity, catalog: room.catalog, option: approvedOption, now }),
      pendingDecisionGuard(binding, room.deal.merchantId, proposal.id, sourceQuote.id, 'approve', now),
      binding.prepare("UPDATE counteroffers SET status='merchant_approved',proposed_option_json=?,decision_summary=?,decided_at=? WHERE id=? AND status='merchant_approval_required'").bind(JSON.stringify(approvedOption), approvedSummary, now, proposal.id),
      ...audit.statements,
    ]);
    return { counteroffer: (await loadDealCounteroffers(binding, dealId)).find(item => item.id === proposal.id)!, quote: null, reused: false };
  }
  const preparedQuote = await prepareQuoteVersion(room, approvedOption, now);
  const audit = await prepareAuditBatch(binding, room.deal.id, [
    {
      id: crypto.randomUUID(),
      quoteId: preparedQuote.id,
      eventType: 'counteroffer_approved',
      actorType: 'merchant',
      summary: `Merchant approved counteroffer and issued quote v${preparedQuote.version}.`,
      data: {
        counterofferId,
        quoteHash: preparedQuote.quoteHash,
        sourceQuoteHash: sourceQuote.quoteHash,
        policyVersion: room.policy.version,
        checks: policyDecision.checks,
        reasonCodes: policyDecision.reasonCodes,
      },
      createdAt: now,
    },
  ]);

  await binding.batch([
    quoteAuthorityGuard(binding, { merchantId: room.deal.merchantId, policyVersion: room.policy.version, quantity: room.deal.quantity, catalog: room.catalog, option: approvedOption, now }),
    pendingDecisionGuard(binding, room.deal.merchantId, proposal.id, sourceQuote.id, 'approve', now),
    binding
      .prepare(
        `UPDATE quotes SET status = 'superseded'
         WHERE id = ? AND status = 'merchant_approved'`,
      )
      .bind(sourceQuote.id),
    quoteInsert(
      binding,
      room.deal.id,
      preparedQuote,
      approvedOption,
      room.deal.quantity,
      now,
    ),
    binding
      .prepare(
        `UPDATE counteroffers
         SET status = 'merchant_approved', proposed_quote_id = ?, decision_summary = ?, decided_at = ?
         WHERE id = ? AND status = 'merchant_approval_required'`,
      )
      .bind(preparedQuote.id, approvedSummary, now, proposal.id),
    ...audit.statements,
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, room.deal.id),
  ]);

  const stored = (await loadDealCounteroffers(binding, dealId)).find(
    (item) => item.id === proposal.id,
  )!;
  const quote = (await loadDealQuotes(binding, dealId)).find(
    (item) => item.id === preparedQuote.id,
  )!;
  return { counteroffer: stored, quote, reused: false };
}

async function loadPublicDealRoomByDeal(binding: D1Database, dealId: string) {
  const quote = (await loadDealQuotes(binding, dealId))[0] as StoredQuote | undefined;
  const row = await binding
    .prepare('SELECT public_token AS publicToken FROM deals WHERE id = ?')
    .bind(dealId)
    .first<{ publicToken: string }>();
  if (!row || !quote) return undefined;
  return loadPublicDealRoom(binding, row.publicToken);
}

function pendingDecisionGuard(binding: D1Database, merchantId: string, counterofferId: string, sourceQuoteId: string, action: string, now: string) {
  return binding.prepare(`INSERT INTO merchant_changes (id, merchant_id, kind, before_json, after_json, created_at)
    VALUES (?, ?, 'counteroffer', (SELECT json_object('id', c.id, 'status', c.status) FROM counteroffers c
      JOIN quotes q ON q.id=c.source_quote_id WHERE c.id=? AND c.status='merchant_approval_required'
      AND q.id=? AND q.status='merchant_approved' AND q.expires_at > ? AND (c.buyer_choice IS NULL OR c.buyer_choice='pending')), ?, ?)`)
    .bind(crypto.randomUUID(), merchantId, counterofferId, sourceQuoteId, now, JSON.stringify({ action }), now);
}

export async function rejectPendingCounteroffer(binding: D1Database, dealId: string, counterofferId: string, now = new Date().toISOString()) {
  const room = await loadPublicDealRoomByDeal(binding, dealId);
  const proposal = (await loadDealCounteroffers(binding, dealId)).find(item => item.id === counterofferId);
  if (!room || !proposal) throw new QuoteWorkflowError('NOT_FOUND', 'This request is unavailable.', 404);
  if (proposal.status !== 'merchant_approval_required' || room.currentQuote?.id !== proposal.sourceQuoteId || room.currentQuote.status !== 'merchant_approved') throw new QuoteWorkflowError('REQUEST_CHANGED', 'This request has already been decided or the order changed. Refresh to see its status.', 409);
  const summary = 'The merchant declined the price reduction. Your original offer is still available.';
  const audit = await prepareAuditBatch(binding, dealId, [{ id: crypto.randomUUID(), quoteId: proposal.sourceQuoteId, eventType: 'counteroffer_rejected', actorType: 'merchant', summary, data: { counterofferId }, createdAt: now }]);
  await binding.batch([
    pendingDecisionGuard(binding, room.deal.merchantId, proposal.id, proposal.sourceQuoteId, 'reject', now),
    binding.prepare("UPDATE counteroffers SET status='rejected', buyer_choice=CASE WHEN buyer_choice='pending' THEN 'original' ELSE buyer_choice END, decision_summary=?, decided_at=? WHERE id=? AND status='merchant_approval_required'").bind(summary, now, proposal.id),
    ...audit.statements,
    binding.prepare('UPDATE deals SET updated_at=? WHERE id=?').bind(now, dealId),
  ]);
  return { rejected: true };
}

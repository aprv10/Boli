import { and, desc, eq } from 'drizzle-orm';
import {
  agentRuns,
  deals,
  intentAgentRuns,
  products,
  purchaseIntents,
  purchaseRequirements,
  quotes,
} from '@/db/schema';
import { getDatabase } from '@/src/adapters/db/database';
import { loadAuditLedgerNewestFirst, prepareAuditBatch } from './audit-ledger';
import { loadActiveMerchantPolicy } from './policy-gate';
import { createQuoteFingerprints } from '@/src/domain/quoting/executable-quote';
import { generateCorporateGiftingQuotes } from '@/src/domain/quoting/corporate-gifting-engine';
import { evaluateCommerceAction, type MerchantPolicy } from '@/src/domain/policies/commerce-policy';
import type {
  CatalogProduct,
  ConstraintCheck,
  HardConstraint,
  QuoteEngineResult,
  QuoteLine,
  QuoteOption,
} from '@/src/domain/quoting/types';

const QUOTE_LIFETIME_MS = 48 * 60 * 60 * 1_000;

export class QuoteWorkflowError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export type DealQuoteWorkspace = {
  deal: {
    id: string;
    merchantId: string;
    intentId: string;
    publicToken: string;
    createdAt: string;
    rawText: string;
    quantity: number;
    maxUnitPaise: number;
    deadline: string;
    hardConstraints: HardConstraint[];
    deliveryLocations: string[];
    agentInterpretation: null | {
      provider: 'mistral';
      model: string;
      reviewStatus: 'confirmed' | 'modified';
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      latencyMs: number;
    };
  };
  policy: MerchantPolicy;
  catalog: CatalogProduct[];
  result: QuoteEngineResult;
};

export type StoredQuote = {
  id: string;
  dealId: string;
  version: number;
  optionKey: QuoteOption['key'];
  label: string;
  rationale: string;
  lines: QuoteLine[];
  checks: ConstraintCheck[];
  quantity: number;
  unitTotalPaise: number;
  orderTotalPaise: number;
  unitCostPaise: number;
  contributionMarginBps: number;
  policyVersion: number;
  intentHash: string;
  quoteHash: string;
  status: 'merchant_approved' | 'buyer_accepted' | 'superseded' | 'expired';
  expiresAt: string;
  createdAt: string;
  approvedAt: string;
  acceptedAt: string | null;
};

export type StoredQuoteEvent = {
  id: string;
  dealId: string;
  quoteId: string | null;
  sequence: number;
  eventType: string;
  actorType: 'buyer' | 'merchant' | 'system';
  summary: string;
  data: Record<string, unknown>;
  previousHash: string;
  eventHash: string;
  createdAt: string;
};

function conditionalQuoteAuditInsert(
  binding: D1Database,
  event: StoredQuoteEvent & { quoteId: string },
  requiredStatus: StoredQuote['status'],
  acceptedAt?: string,
) {
  const acceptedPredicate = acceptedAt ? ' AND accepted_at = ?' : '';
  const values = [
    event.id,
    event.dealId,
    event.quoteId,
    event.sequence,
    event.eventType,
    event.actorType,
    event.summary,
    JSON.stringify(event.data),
    event.previousHash,
    event.eventHash,
    event.createdAt,
    event.quoteId,
    requiredStatus,
    ...(acceptedAt ? [acceptedAt] : []),
  ];
  return binding
    .prepare(
      `INSERT OR IGNORE INTO quote_events (
        id, deal_id, quote_id, sequence, event_type, actor_type,
        summary, data_json, previous_hash, event_hash, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM quotes WHERE id = ? AND status = ?${acceptedPredicate}`,
    )
    .bind(...values);
}

function parseQuote(row: typeof quotes.$inferSelect): StoredQuote {
  return {
    id: row.id,
    dealId: row.dealId,
    version: row.version,
    optionKey: row.optionKey,
    label: row.label,
    rationale: row.rationale,
    lines: JSON.parse(row.linesJson) as QuoteLine[],
    checks: JSON.parse(row.checksJson) as ConstraintCheck[],
    quantity: row.quantity,
    unitTotalPaise: row.unitTotalPaise,
    orderTotalPaise: row.orderTotalPaise,
    unitCostPaise: row.unitCostPaise,
    contributionMarginBps: row.contributionMarginBps,
    policyVersion: row.policyVersion,
    intentHash: row.intentHash,
    quoteHash: row.quoteHash,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    acceptedAt: row.acceptedAt,
  };
}

export async function loadDealQuoteWorkspace(
  binding: D1Database,
  dealId: string,
  now = new Date().toISOString(),
): Promise<DealQuoteWorkspace | undefined> {
  const db = getDatabase(binding);
  const [record] = await db
    .select({
      id: deals.id,
      merchantId: deals.merchantId,
      intentId: deals.intentId,
      publicToken: deals.publicToken,
      createdAt: deals.createdAt,
      rawText: purchaseIntents.rawText,
      constraintsJson: purchaseIntents.constraintsJson,
      quantity: purchaseRequirements.quantity,
      maxUnitPaise: purchaseRequirements.maxUnitPaise,
      deliveryLocationsJson: purchaseRequirements.deliveryLocationsJson,
      deadline: purchaseRequirements.deadline,
      agentProvider: agentRuns.provider,
      agentModel: agentRuns.model,
      agentReviewStatus: intentAgentRuns.reviewStatus,
      agentPromptTokens: agentRuns.promptTokens,
      agentCompletionTokens: agentRuns.completionTokens,
      agentTotalTokens: agentRuns.totalTokens,
      agentLatencyMs: agentRuns.latencyMs,
    })
    .from(deals)
    .innerJoin(purchaseIntents, eq(deals.intentId, purchaseIntents.id))
    .innerJoin(
      purchaseRequirements,
      eq(purchaseIntents.id, purchaseRequirements.intentId),
    )
    .leftJoin(intentAgentRuns, eq(purchaseIntents.id, intentAgentRuns.intentId))
    .leftJoin(agentRuns, eq(intentAgentRuns.agentRunId, agentRuns.id))
    .where(eq(deals.id, dealId))
    .limit(1);

  if (!record) return undefined;

  const catalogRows = await db
    .select()
    .from(products)
    .where(and(eq(products.merchantId, record.merchantId), eq(products.active, true)));
  const catalog: CatalogProduct[] = catalogRows.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    tags: JSON.parse(product.tagsJson) as string[],
    unitPricePaise: product.unitPricePaise,
    unitCostPaise: product.unitCostPaise,
    availableQuantity: product.availableQuantity,
    leadTimeDays: product.leadTimeDays,
  }));
  const hardConstraints = JSON.parse(record.constraintsJson) as HardConstraint[];
  const deliveryLocations = JSON.parse(record.deliveryLocationsJson) as string[];
  const policy = await loadActiveMerchantPolicy(binding, record.merchantId);

  return {
    deal: {
      ...record,
      hardConstraints,
      deliveryLocations,
      agentInterpretation:
        record.agentProvider &&
        record.agentModel &&
        record.agentReviewStatus &&
        record.agentPromptTokens !== null &&
        record.agentCompletionTokens !== null &&
        record.agentTotalTokens !== null &&
        record.agentLatencyMs !== null
          ? {
              provider: record.agentProvider,
              model: record.agentModel,
              reviewStatus: record.agentReviewStatus,
              promptTokens: record.agentPromptTokens,
              completionTokens: record.agentCompletionTokens,
              totalTokens: record.agentTotalTokens,
              latencyMs: record.agentLatencyMs,
            }
          : null,
    },
    policy,
    catalog,
    result: generateCorporateGiftingQuotes(catalog, {
      quantity: record.quantity,
      maxUnitPaise: record.maxUnitPaise,
      deliveryLocations,
      deadline: record.deadline,
      hardConstraints,
      minimumMarginBps: policy.minimumMarginBps,
      now,
    }),
  };
}

export async function loadDealQuotes(binding: D1Database, dealId: string) {
  const db = getDatabase(binding);
  const rows = await db
    .select()
    .from(quotes)
    .where(eq(quotes.dealId, dealId))
    .orderBy(desc(quotes.version));
  return rows.map(parseQuote);
}

export async function loadDealEvents(binding: D1Database, dealId: string) {
  const ledger = await loadAuditLedgerNewestFirst(binding, dealId);
  return ledger.events as StoredQuoteEvent[];
}

export async function approveQuoteOption(
  binding: D1Database,
  dealId: string,
  optionKey: QuoteOption['key'],
  now = new Date().toISOString(),
) {
  const workspace = await loadDealQuoteWorkspace(binding, dealId, now);
  if (!workspace) {
    throw new QuoteWorkflowError('DEAL_NOT_FOUND', 'This deal does not exist.', 404);
  }
  if (workspace.result.status === 'rejected') {
    throw new QuoteWorkflowError(
      'NO_SAFE_QUOTE',
      'The current mandate has no policy-safe quote to approve.',
      409,
    );
  }

  const option = workspace.result.options.find((candidate) => candidate.key === optionKey);
  if (!option) {
    throw new QuoteWorkflowError('OPTION_NOT_FOUND', 'That quote option is unavailable.', 404);
  }
  const policyDecision = evaluateCommerceAction({
    action: 'approve_quote',
    policy: workspace.policy,
    now,
    buyerMaxUnitPaise: workspace.deal.maxUnitPaise,
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
      `The quote failed policy: ${policyDecision.reasonCodes.join(', ')}.`,
      409,
    );
  }
  const checksByCode = new Map(
    [...option.checks, ...policyDecision.checks].map((check) => [check.code, check]),
  );
  const approvedOption = { ...option, checks: [...checksByCode.values()] };

  const history = await loadDealQuotes(binding, dealId);
  const accepted = history.find((quote) => quote.status === 'buyer_accepted');
  if (accepted) {
    throw new QuoteWorkflowError(
      'QUOTE_ALREADY_ACCEPTED',
      'The buyer has already accepted an executable quote for this deal.',
      409,
    );
  }
  let alreadyApproved: StoredQuote | undefined;
  for (const quote of history) {
    if (
      quote.status !== 'merchant_approved' ||
      quote.optionKey !== optionKey ||
      quote.policyVersion !== workspace.policy.version ||
      Date.parse(quote.expiresAt) <= Date.parse(now)
    ) {
      continue;
    }
    const fingerprints = await createQuoteFingerprints({
      dealId,
      intentId: workspace.deal.intentId,
      version: quote.version,
      quantity: workspace.deal.quantity,
      maxUnitPaise: workspace.deal.maxUnitPaise,
      deliveryLocations: workspace.deal.deliveryLocations,
      deadline: workspace.deal.deadline,
      hardConstraints: workspace.deal.hardConstraints,
      policyVersion: quote.policyVersion,
      option: approvedOption,
      expiresAt: quote.expiresAt,
    });
    if (
      fingerprints.intentHash === quote.intentHash &&
      fingerprints.quoteHash === quote.quoteHash
    ) {
      alreadyApproved = quote;
      break;
    }
  }
  if (alreadyApproved) {
    return { quote: alreadyApproved, publicToken: workspace.deal.publicToken, reused: true };
  }

  const version = (history[0]?.version ?? 0) + 1;
  const expiresAt = new Date(Date.parse(now) + QUOTE_LIFETIME_MS).toISOString();
  const { intentHash, quoteHash } = await createQuoteFingerprints({
    dealId,
    intentId: workspace.deal.intentId,
    version,
    quantity: workspace.deal.quantity,
    maxUnitPaise: workspace.deal.maxUnitPaise,
    deliveryLocations: workspace.deal.deliveryLocations,
    deadline: workspace.deal.deadline,
    hardConstraints: workspace.deal.hardConstraints,
    policyVersion: workspace.policy.version,
    option: approvedOption,
    expiresAt,
  });
  const quoteId = crypto.randomUUID();
  const audit = await prepareAuditBatch(binding, dealId, [
    {
      id: crypto.randomUUID(),
      quoteId,
      eventType: 'quote_approved',
      actorType: 'merchant',
      summary: `Merchant approved quote v${version} · ${approvedOption.label}.`,
      data: {
        quoteHash,
        version,
        optionKey,
        orderTotalPaise: approvedOption.orderTotalPaise,
        policyVersion: workspace.policy.version,
        checks: policyDecision.checks,
        reasonCodes: policyDecision.reasonCodes,
      },
      createdAt: now,
    },
  ]);

  await binding.batch([
    binding
      .prepare(
        `UPDATE quotes SET status = 'superseded'
         WHERE deal_id = ? AND status = 'merchant_approved'`,
      )
      .bind(dealId),
    binding
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
        quoteId,
        dealId,
        version,
        option.key,
        approvedOption.label,
        approvedOption.rationale,
        JSON.stringify(approvedOption.lines),
        JSON.stringify(approvedOption.checks),
        workspace.deal.quantity,
        approvedOption.unitTotalPaise,
        approvedOption.orderTotalPaise,
        approvedOption.unitCostPaise,
        approvedOption.contributionMarginBps,
        workspace.policy.version,
        intentHash,
        quoteHash,
        expiresAt,
        now,
        now,
      ),
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, dealId),
    ...audit.statements,
  ]);

  return {
    quote: (await loadDealQuotes(binding, dealId))[0],
    publicToken: workspace.deal.publicToken,
    reused: false,
  };
}

export async function loadPublicDealRoom(binding: D1Database, publicToken: string) {
  const db = getDatabase(binding);
  const [deal] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(eq(deals.publicToken, publicToken))
    .limit(1);
  if (!deal) return undefined;

  const evaluatedAt = new Date().toISOString();
  const workspace = await loadDealQuoteWorkspace(binding, deal.id, evaluatedAt);
  if (!workspace) return undefined;
  const quoteHistory = await loadDealQuotes(binding, deal.id);
  const auditLedger = await loadAuditLedgerNewestFirst(binding, deal.id);
  return {
    ...workspace,
    quoteHistory,
    currentQuote: quoteHistory.find(
      (quote) => quote.status === 'buyer_accepted' || quote.status === 'merchant_approved',
    ),
    events: auditLedger.events as StoredQuoteEvent[],
    auditVerified: auditLedger.verified,
    auditHeadHash: auditLedger.headHash,
    evaluatedAt,
  };
}

export async function acceptCurrentQuote(
  binding: D1Database,
  publicToken: string,
  expectedQuoteHash: string,
  context: {
    now?: string;
    channel?: 'human_buyer' | 'ai_buyer';
  } = {},
) {
  const now = context.now ?? new Date().toISOString();
  const channel = context.channel ?? 'human_buyer';
  const room = await loadPublicDealRoom(binding, publicToken);
  if (!room) {
    throw new QuoteWorkflowError('DEAL_NOT_FOUND', 'This Deal Room does not exist.', 404);
  }
  const quote = room.currentQuote;
  if (!quote) {
    throw new QuoteWorkflowError(
      'NO_EXECUTABLE_QUOTE',
      'The merchant has not issued an executable quote yet.',
      409,
    );
  }
  if (quote.quoteHash !== expectedQuoteHash) {
    throw new QuoteWorkflowError(
      'QUOTE_CHANGED',
      'The executable quote changed before acceptance. Refresh and review the new version.',
      409,
    );
  }
  if (quote.status === 'buyer_accepted') {
    return { quote, alreadyAccepted: true };
  }

  if (Date.parse(quote.expiresAt) <= Date.parse(now)) {
    const audit = await prepareAuditBatch(binding, room.deal.id, [
      {
        id: crypto.randomUUID(),
        quoteId: quote.id,
        eventType: 'quote_expired',
        actorType: 'system',
        summary: `Quote v${quote.version} expired before acceptance.`,
        data: {
          quoteHash: quote.quoteHash,
          expiresAt: quote.expiresAt,
          policyVersion: quote.policyVersion,
          reasonCodes: ['QUOTE_NOT_EXPIRED_FAILED'],
        },
        createdAt: now,
      },
    ]);
    await binding.batch([
      binding
        .prepare(
          `UPDATE quotes SET status = 'expired'
           WHERE id = ? AND status = 'merchant_approved'`,
        )
        .bind(quote.id),
      conditionalQuoteAuditInsert(
        binding,
        audit.events[0] as StoredQuoteEvent & { quoteId: string },
        'expired',
      ),
    ]);
    throw new QuoteWorkflowError(
      'QUOTE_EXPIRED',
      'This quote expired before it could be accepted. Ask the merchant to reissue it.',
      410,
    );
  }

  const policyDecision = evaluateCommerceAction({
    action: 'accept_quote',
    policy: room.policy,
    now,
    buyerMaxUnitPaise: room.deal.maxUnitPaise,
    expectedQuoteHash,
    quote: {
      status: quote.status,
      unitTotalPaise: quote.unitTotalPaise,
      contributionMarginBps: quote.contributionMarginBps,
      expiresAt: quote.expiresAt,
      quoteHash: quote.quoteHash,
      checks: quote.checks,
    },
  });
  if (!policyDecision.allowed) {
    throw new QuoteWorkflowError(
      'POLICY_REJECTED',
      `The quote is no longer acceptable: ${policyDecision.reasonCodes.join(', ')}.`,
      409,
    );
  }
  const audit = await prepareAuditBatch(binding, room.deal.id, [
    {
      id: crypto.randomUUID(),
      quoteId: quote.id,
      eventType: 'quote_accepted',
      actorType: 'buyer',
      summary: `Buyer accepted quote v${quote.version} exactly as approved.`,
      data: {
        quoteHash: quote.quoteHash,
        orderTotalPaise: quote.orderTotalPaise,
        policyVersion: quote.policyVersion,
        channel,
        checks: policyDecision.checks,
        reasonCodes: policyDecision.reasonCodes,
      },
      createdAt: now,
    },
  ]);

  const results = await binding.batch([
    binding
      .prepare(
        `UPDATE quotes SET status = 'buyer_accepted', accepted_at = ?
         WHERE id = ? AND status = 'merchant_approved' AND expires_at > ?`,
      )
      .bind(now, quote.id, now),
    conditionalQuoteAuditInsert(
      binding,
      audit.events[0] as StoredQuoteEvent & { quoteId: string },
      'buyer_accepted',
      now,
    ),
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, room.deal.id),
  ]);

  if ((results[0].meta.changes ?? 0) !== 1) {
    const refreshed = await loadPublicDealRoom(binding, publicToken);
    const accepted = refreshed?.quoteHistory.find((item) => item.id === quote.id);
    if (accepted?.status === 'buyer_accepted') return { quote: accepted, alreadyAccepted: true };
    throw new QuoteWorkflowError(
      'QUOTE_NOT_ACCEPTABLE',
      'The quote changed before acceptance. Refresh the Deal Room and try again.',
      409,
    );
  }

  const accepted = (await loadDealQuotes(binding, room.deal.id)).find(
    (item) => item.id === quote.id,
  )!;
  return { quote: accepted, alreadyAccepted: false };
}

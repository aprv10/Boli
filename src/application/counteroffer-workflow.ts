import { desc, eq } from 'drizzle-orm';
import { counteroffers } from '@/db/schema';
import { getDatabase } from '@/src/adapters/db/database';
import {
  DEFAULT_NEGOTIATION_POLICY,
  evaluateBoundedCounteroffer,
  type CounterofferDecision,
} from '@/src/domain/negotiation/bounded-counteroffer';
import { createQuoteFingerprints } from '@/src/domain/quoting/executable-quote';
import { generateCorporateGiftingQuotes } from '@/src/domain/quoting/corporate-gifting-engine';
import type { ConstraintCheck, QuoteOption } from '@/src/domain/quoting/types';
import {
  loadDealQuotes,
  loadPublicDealRoom,
  QuoteWorkflowError,
  type StoredQuote,
} from './quote-workflow';

const QUOTE_LIFETIME_MS = 48 * 60 * 60 * 1_000;

export type StoredCounteroffer = {
  id: string;
  dealId: string;
  sourceQuoteId: string;
  proposedQuoteId: string | null;
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
  const label = decision.targetMet ? 'Target matched' : 'Boli safe floor';
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
    option,
    expiresAt,
  });
  return {
    id: crypto.randomUUID(),
    version,
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
        unit_cost_paise, contribution_margin_bps, intent_hash, quote_hash,
        status, expires_at, created_at, approved_at, accepted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
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
  },
  now = new Date().toISOString(),
) {
  const room = await loadPublicDealRoom(binding, publicToken);
  if (!room) {
    throw new QuoteWorkflowError('DEAL_NOT_FOUND', 'This Deal Room does not exist.', 404);
  }
  const sourceQuote = room.currentQuote;
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

  const targetResult = generateCorporateGiftingQuotes(room.catalog, {
    quantity: room.deal.quantity,
    maxUnitPaise: Math.min(input.targetUnitPaise, room.deal.maxUnitPaise),
    deliveryLocations: room.deal.deliveryLocations,
    deadline: room.deal.deadline,
    hardConstraints: room.deal.hardConstraints,
    minimumMarginBps: DEFAULT_NEGOTIATION_POLICY.minimumMarginBps,
    now,
  });
  const decision = evaluateBoundedCounteroffer({
    sourceQuote,
    targetUnitPaise: input.targetUnitPaise,
    originalMaxUnitPaise: room.deal.maxUnitPaise,
    hardConstraints: room.deal.hardConstraints,
    targetResult,
    baselineResult: room.result,
  });
  const counterofferId = crypto.randomUUID();
  const nextSequence = (room.events[0]?.sequence ?? 0) + 1;
  const automaticallyIssued =
    decision.status === 'auto_approved' ||
    decision.status === 'bounded_counteroffer';
  const option = automaticallyIssued
    ? negotiatedOption(decision, 'automatic')
    : decision.proposedOption;
  const preparedQuote = automaticallyIssued && option
    ? await prepareQuoteVersion(room, option, now)
    : null;
  const decidedAt =
    decision.status === 'merchant_approval_required' ? null : now;

  const statements: D1PreparedStatement[] = [
    binding
      .prepare(
        `INSERT INTO counteroffers (
          id, deal_id, source_quote_id, proposed_quote_id, source_kind,
          buyer_message, target_unit_paise, status, proposed_option_json,
          checks_json, reason_codes_json, decision_summary, created_at, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        counterofferId,
        room.deal.id,
        sourceQuote.id,
        null,
        input.sourceKind ?? 'structured',
        input.buyerMessage,
        input.targetUnitPaise,
        decision.status,
        option ? JSON.stringify(option) : null,
        JSON.stringify(decision.checks),
        JSON.stringify(decision.reasonCodes),
        decision.summary,
        now,
        decidedAt,
      ),
    binding
      .prepare(
        `INSERT INTO quote_events (
          id, deal_id, quote_id, sequence, event_type, actor_type,
          summary, data_json, created_at
        ) VALUES (?, ?, NULL, ?, 'counteroffer_submitted', 'buyer', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        room.deal.id,
        nextSequence,
        `Buyer requested ${Math.round(input.targetUnitPaise / 100)} INR per kit against quote v${sourceQuote.version}.`,
        JSON.stringify({
          counterofferId,
          sourceQuoteHash: sourceQuote.quoteHash,
          targetUnitPaise: input.targetUnitPaise,
        }),
        now,
      ),
    binding
      .prepare(
        `INSERT INTO quote_events (
          id, deal_id, quote_id, sequence, event_type, actor_type,
          summary, data_json, created_at
        ) VALUES (?, ?, NULL, ?, 'counteroffer_evaluated', 'system', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        room.deal.id,
        nextSequence + 1,
        decision.summary,
        JSON.stringify({
          counterofferId,
          status: decision.status,
          checks: decision.checks,
          reasonCodes: decision.reasonCodes,
          proposedUnitPaise: decision.proposedUnitPaise,
        }),
        now,
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
      binding
        .prepare(
          `INSERT INTO quote_events (
            id, deal_id, quote_id, sequence, event_type, actor_type,
            summary, data_json, created_at
          ) VALUES (?, ?, ?, ?, 'quote_approved', 'system', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          room.deal.id,
          preparedQuote.id,
          nextSequence + 2,
          `Boli issued negotiated quote v${preparedQuote.version} inside automatic authority.`,
          JSON.stringify({
            counterofferId,
            quoteHash: preparedQuote.quoteHash,
            policy: DEFAULT_NEGOTIATION_POLICY,
          }),
          now,
        ),
    );
  }
  statements.push(
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, room.deal.id),
  );
  await binding.batch(statements);

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
  if (
    proposal.status !== 'merchant_approval_required' ||
    !proposal.proposedOption
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
    sourceQuote.status !== 'merchant_approved'
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
    concessionBps: Math.floor(
      ((sourceQuote.unitTotalPaise - proposal.proposedOption.unitTotalPaise) * 10_000) /
        sourceQuote.unitTotalPaise,
    ),
    checks: proposal.checks,
    reasonCodes: proposal.reasonCodes,
    summary: proposal.decisionSummary,
  };
  const option = negotiatedOption(decision, 'merchant');
  const preparedQuote = await prepareQuoteVersion(room, option, now);
  const nextSequence = (room.events[0]?.sequence ?? 0) + 1;

  await binding.batch([
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
      option,
      room.deal.quantity,
      now,
    ),
    binding
      .prepare(
        `UPDATE counteroffers
         SET status = 'merchant_approved', proposed_quote_id = ?, decided_at = ?
         WHERE id = ? AND status = 'merchant_approval_required'`,
      )
      .bind(preparedQuote.id, now, proposal.id),
    binding
      .prepare(
        `INSERT INTO quote_events (
          id, deal_id, quote_id, sequence, event_type, actor_type,
          summary, data_json, created_at
        ) VALUES (?, ?, ?, ?, 'counteroffer_approved', 'merchant', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        room.deal.id,
        preparedQuote.id,
        nextSequence,
        `Merchant approved counteroffer and issued quote v${preparedQuote.version}.`,
        JSON.stringify({
          counterofferId,
          quoteHash: preparedQuote.quoteHash,
          sourceQuoteHash: sourceQuote.quoteHash,
        }),
        now,
      ),
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

import { and, eq } from 'drizzle-orm';
import { deals, merchants, products } from '@/db/schema';
import { getDatabase } from '@/src/adapters/db/database';
import { DEMO_MERCHANT } from '@/src/adapters/db/seed-data';
import { loadAuditLedger } from '@/src/application/audit-ledger';
import { chooseCounteroffer, loadDealCounteroffers, submitBoundedCounteroffer } from '@/src/application/counteroffer-workflow';
import { submitPurchaseIntent, type SubmitPurchaseIntentInput } from '@/src/application/intent-workflow';
import { loadActiveMerchantPolicy } from '@/src/application/policy-gate';
import {
  createCheckoutOrder,
  loadDealPaymentState,
} from '@/src/application/payment-workflow';
import {
  acceptCurrentQuote,
  approveQuoteOption,
  loadDealQuoteWorkspace,
  loadDealQuotes,
  QuoteWorkflowError,
} from '@/src/application/quote-workflow';
import type { QuoteOption } from '@/src/domain/quoting/types';
import { requiresMerchantReview } from '@/src/domain/quoting/custom-requirements';
import { loadCustomQuoteRequest } from '@/src/application/custom-quote-workflow';
import { rankDealOptions } from '@/src/application/recommendation-workflow';
import { acceptSafeUpsell, findSafeUpsell } from '@/src/application/upsell-workflow';

export async function describeMerchantForAgent(binding: D1Database) {
  const db = getDatabase(binding);
  const [merchant] = await db
    .select()
    .from(merchants)
    .where(and(eq(merchants.id, DEMO_MERCHANT.id), eq(merchants.status, 'active')))
    .limit(1);
  if (!merchant) throw new QuoteWorkflowError('MERCHANT_NOT_FOUND', 'Merchant unavailable.', 404);
  const catalog = await db
    .select({
      productId: products.id,
      sku: products.sku,
      name: products.name,
      category: products.category,
      tagsJson: products.tagsJson,
      unitPricePaise: products.unitPricePaise,
      availableQuantity: products.availableQuantity,
      reservedQuantity: products.reservedQuantity,
      leadTimeDays: products.leadTimeDays,
    })
    .from(products)
    .where(and(eq(products.merchantId, merchant.id), eq(products.active, true)));
  const policy = await loadActiveMerchantPolicy(binding, merchant.id);
  return {
    merchant: { id: merchant.id, name: merchant.name, slug: merchant.slug, currency: 'INR' },
    shoppingModes: ['kit', 'product'],
    catalog: catalog.map(({ tagsJson, reservedQuantity, ...item }) => ({
      ...item,
      availableQuantity: Math.max(0, item.availableQuantity - reservedQuantity),
      tags: JSON.parse(tagsJson) as string[],
    })),
    buyingLimits: {
      minimumQuantity: 1,
      maximumQuantity: 10_000,
      minimumUnitPaise: 100,
      maximumUnitPaise: 10_000_000,
      supportedConstraints: ['vegan', 'plastic-free', 'branded', 'multi-city'],
      customRequirements: 'Required custom requirements need merchant confirmation; optional preferences are not guaranteed.',
    },
    policy: {
      version: policy.version,
      automaticNegotiationConcessionBps: policy.maximumAutomaticConcessionBps,
      deeperConcessions: 'merchant_approval_required',
      automaticQuoteAuthorization: 'Eligible offers are issued by the backend under the active policy. No additional merchant click is required.',
    },
  };
}

export async function submitAgentPurchaseIntent(
  binding: D1Database,
  input: SubmitPurchaseIntentInput,
) {
  const deal = await submitPurchaseIntent(binding, { ...input, channel: 'ai_buyer' });
  return { ...deal, dealRoomPath: `/deal/${deal.publicToken}` };
}

export async function getAgentDealSnapshot(binding: D1Database, dealId: string, options: { rankOptions?: boolean; apiKey?: string } = {}) {
  const workspace = await loadDealQuoteWorkspace(binding, dealId);
  if (!workspace) throw new QuoteWorkflowError('DEAL_NOT_FOUND', 'Deal unavailable.', 404);
  const [history, payment, customRequest, negotiations] = await Promise.all([
    loadDealQuotes(binding, dealId), loadDealPaymentState(binding, dealId),
    loadCustomQuoteRequest(binding, dealId), loadDealCounteroffers(binding, dealId),
  ]);
  const currentQuote = history.find(quote => quote.status === 'buyer_accepted' || quote.status === 'merchant_approved');
  const expired = Boolean(currentQuote && Date.parse(currentQuote.expiresAt) <= Date.parse(workspace.evaluatedAt));
  const latest = negotiations[0];
  const pendingNegotiation = latest && latest.sourceQuoteId === currentQuote?.id && !expired
    && currentQuote.status === 'merchant_approved' && latest.buyerChoice === 'pending' ? latest : null;
  const mandatoryReview = requiresMerchantReview(workspace.deal.customRequirements);
  const reviewStage = customRequest?.status === 'needs_changes' ? 'requirements_need_changes'
    : customRequest?.status === 'declined' ? 'request_declined' : 'awaiting_merchant_approval';
  const stage = payment.stage === 'refunded' ? 'refunded'
    : payment.stage === 'refund_pending' ? 'refund_pending'
    : payment.stage === 'replacement_offered' ? 'recovery_offer_pending'
    : payment.stage === 'paid' ? 'paid'
    : payment.stage === 'payment_pending' ? 'payment_pending'
    : currentQuote?.status === 'buyer_accepted' ? 'accepted'
    : expired ? 'quote_expired'
    : pendingNegotiation?.status === 'merchant_approval_required' ? 'awaiting_merchant_approval'
    : pendingNegotiation ? 'counteroffer_choice_required'
    : currentQuote ? 'ready_to_accept'
    : mandatoryReview || customRequest ? reviewStage
    : workspace.result.status === 'rejected' ? 'not_fulfillable'
    : 'ready_to_select';
  const generated = workspace.result.status === 'generated' && !mandatoryReview && !customRequest
    ? options.rankOptions
      ? await rankDealOptions(binding, workspace, options.apiKey)
      : workspace.result.options.map(option => ({ ...option, recommendationSource: 'deterministic' as const }))
    : [];
  const publicLines = (lines: QuoteOption['lines']) => lines.map(({ code, label, kind, unitPricePaise, productId }) => ({
    code, label, kind, unitPricePaise, productId,
  }));
  return {
    deal: {
      id: workspace.deal.id, publicToken: workspace.deal.publicToken, stage,
      mandate: {
        selection: workspace.deal.selection ?? { mode: 'kit', query: '' },
        customRequirements: workspace.deal.customRequirements,
        quantity: workspace.deal.quantity, maxUnitPaise: workspace.deal.maxUnitPaise,
        hardConstraints: workspace.deal.hardConstraints, deliveryLocations: workspace.deal.deliveryLocations, deadline: workspace.deal.deadline,
      },
      dealRoomPath: `/deal/${workspace.deal.publicToken}`,
    },
    customRequest,
    options: generated.map(option => ({
      key: option.key, label: option.label, recommended: option.recommended ?? false,
      recommendationSource: option.recommendationSource, rationale: option.rationale,
      unitTotalPaise: option.unitTotalPaise, orderTotalPaise: option.orderTotalPaise, headroomPaise: option.headroomPaise,
      deliveryDays: Number(option.checks.find(check => check.code === 'LEAD_TIME_FEASIBLE')?.observed.replace('d', '') ?? 0),
      lines: publicLines(option.lines), checks: option.checks,
    })),
    rejectionReasons: workspace.result.status === 'rejected' ? workspace.result.reasons : [],
    currentQuote: currentQuote ? {
      id: currentQuote.id, version: currentQuote.version, label: currentQuote.label,
      unitTotalPaise: currentQuote.unitTotalPaise, orderTotalPaise: currentQuote.orderTotalPaise,
      quoteHash: currentQuote.quoteHash, policyVersion: currentQuote.policyVersion,
      expiresAt: currentQuote.expiresAt, status: currentQuote.status,
      lines: publicLines(currentQuote.lines), checks: currentQuote.checks,
    } : null,
    negotiation: latest ? {
      id: latest.id, status: latest.status, buyerChoice: latest.buyerChoice,
      sourceQuoteHash: history.find(quote => quote.id === latest.sourceQuoteId)?.quoteHash ?? null,
      targetUnitPaise: latest.targetUnitPaise, proposedUnitPaise: latest.proposedOption?.unitTotalPaise ?? null,
      proposedLines: latest.proposedOption ? publicLines(latest.proposedOption.lines) : [],
      summary: latest.decisionSummary, checks: latest.checks, reasonCodes: latest.reasonCodes,
      awaitingBuyerChoice: Boolean(pendingNegotiation),
    } : null,
    payment: {
      stage: payment.stage,
      order: payment.order ? {
        providerOrderId: payment.order.providerOrderId, provider: payment.order.provider,
        amountPaise: payment.order.amountPaise, currency: payment.order.currency, status: payment.order.status,
      } : null,
      providerPaymentId: payment.payment?.providerPaymentId ?? null, refund: payment.refund,
    },
  };
}

async function agentDealToken(binding: D1Database, dealId: string) {
  const [deal] = await getDatabase(binding).select({ publicToken: deals.publicToken })
    .from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) throw new QuoteWorkflowError('DEAL_NOT_FOUND', 'Deal unavailable.', 404);
  return deal.publicToken;
}

export async function selectAgentOption(binding: D1Database, dealId: string, optionKey: QuoteOption['key']) {
  const review = await loadCustomQuoteRequest(binding, dealId);
  if (review) throw new QuoteWorkflowError('MERCHANT_REVIEW_REQUESTED', 'This request is in the store-review workflow. Use the merchant-confirmed offer, or start a new request.', 409);
  // The model chooses a key. The same authoritative backend as the buyer UI
  // regenerates that option, checks stock and policy, and binds its exact hash.
  const result = await approveQuoteOption(binding, dealId, optionKey, new Date().toISOString(), 'system');
  return { quote: { id: result.quote.id, version: result.quote.version, quoteHash: result.quote.quoteHash,
    unitTotalPaise: result.quote.unitTotalPaise, orderTotalPaise: result.quote.orderTotalPaise,
    status: result.quote.status, checks: result.quote.checks, expiresAt: result.quote.expiresAt },
    dealRoomPath: `/deal/${result.publicToken}`, reused: result.reused };
}

export async function chooseAgentCounteroffer(binding: D1Database, dealId: string, input: {
  counterofferId: string; expectedQuoteHash: string; choice: 'original' | 'revised';
}) {
  const result = await chooseCounteroffer(binding, await agentDealToken(binding, dealId), input);
  const snapshot = await getAgentDealSnapshot(binding, dealId);
  return { ...result, choice: input.choice, quote: snapshot.currentQuote };
}

export async function getAgentUpsell(binding: D1Database, dealId: string, apiKey?: string) {
  const snapshot = await getAgentDealSnapshot(binding, dealId);
  if (snapshot.deal.stage !== 'ready_to_accept') return null;
  return findSafeUpsell(binding, snapshot.deal.publicToken, new Date().toISOString(), apiKey);
}

export async function acceptAgentUpsell(binding: D1Database, dealId: string, input: {
  expectedQuoteHash: string; productId: string; expectedUnitPricePaise: number;
}) {
  return acceptSafeUpsell(binding, await agentDealToken(binding, dealId), input.expectedQuoteHash, input);
}
export async function submitAgentCounteroffer(
  binding: D1Database,
  dealId: string,
  input: { expectedQuoteHash: string; targetUnitPaise: number; buyerMessage: string; allowAlternatives?: boolean },
) {
  const [deal] = await getDatabase(binding)
    .select({ publicToken: deals.publicToken })
    .from(deals)
    .where(eq(deals.id, dealId))
    .limit(1);
  if (!deal) throw new QuoteWorkflowError('DEAL_NOT_FOUND', 'Deal unavailable.', 404);
  return submitBoundedCounteroffer(binding, deal.publicToken, {
    ...input,
    sourceKind: 'structured',
    allowAlternatives: input.allowAlternatives ?? false,
    awaitBuyerChoice: true,
  });
}

export async function acceptAgentQuote(
  binding: D1Database,
  dealId: string,
  expectedQuoteHash: string,
) {
  const snapshot = await getAgentDealSnapshot(binding, dealId);
  const quote = snapshot.currentQuote;
  if (!quote) {
    throw new QuoteWorkflowError(
      'HUMAN_APPROVAL_REQUIRED',
      'No merchant-approved executable quote is available yet.',
      409,
    );
  }
  const result = await acceptCurrentQuote(
    binding,
    snapshot.deal.publicToken,
    expectedQuoteHash,
    { channel: 'ai_buyer' },
  );
  return {
    quote: result.quote,
    alreadyAccepted: result.alreadyAccepted,
    dealRoomPath: snapshot.deal.dealRoomPath,
    nextAction: 'CREATE_CHECKOUT_REQUIRES_SEPARATE_GATE',
  };
}

export async function createAgentCheckout(
  binding: D1Database,
  dealId: string,
  expectedQuoteHash: string,
  idempotencyKey: string,
) {
  const snapshot = await getAgentDealSnapshot(binding, dealId);
  if (!snapshot.currentQuote || snapshot.currentQuote.status !== 'buyer_accepted') {
    throw new QuoteWorkflowError(
      'QUOTE_NOT_ACCEPTED',
      'The AI buyer must accept the exact executable quote before requesting checkout.',
      409,
    );
  }
  const result = await createCheckoutOrder(
    binding,
    snapshot.deal.publicToken,
    expectedQuoteHash,
    idempotencyKey,
  );
  return {
    ...result,
    nextAction:
      result.state.order?.provider === 'demo'
        ? 'EXPLICIT_DEMO_PAYMENT_CONFIRMATION_REQUIRED'
        : 'OPEN_RAZORPAY_TEST_CHECKOUT',
  };
}

export async function getAgentAuditReceipt(binding: D1Database, dealId: string) {
  const snapshot = await getAgentDealSnapshot(binding, dealId);
  const ledger = await loadAuditLedger(binding, dealId);
  return {
    dealId,
    stage: snapshot.deal.stage,
    verified: ledger.verified,
    headHash: ledger.headHash,
    events: ledger.events.map((event) => ({
      sequence: event.sequence,
      action: event.eventType,
      actor: event.actorType,
      summary: event.summary,
      facts: event.data,
      previousHash: event.previousHash,
      eventHash: event.eventHash,
      createdAt: event.createdAt,
    })),
  };
}

import { and, eq } from 'drizzle-orm';
import { deals, merchants, products } from '@/db/schema';
import { getDatabase } from '@/src/adapters/db/database';
import { DEMO_MERCHANT } from '@/src/adapters/db/seed-data';
import { loadAuditLedger } from '@/src/application/audit-ledger';
import { submitBoundedCounteroffer } from '@/src/application/counteroffer-workflow';
import { submitPurchaseIntent, type SubmitPurchaseIntentInput } from '@/src/application/intent-workflow';
import { loadActiveMerchantPolicy } from '@/src/application/policy-gate';
import {
  createCheckoutOrder,
  loadDealPaymentState,
} from '@/src/application/payment-workflow';
import {
  acceptCurrentQuote,
  loadDealQuoteWorkspace,
  loadDealQuotes,
  QuoteWorkflowError,
} from '@/src/application/quote-workflow';

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
      sku: products.sku,
      name: products.name,
      category: products.category,
      tagsJson: products.tagsJson,
      unitPricePaise: products.unitPricePaise,
      availableQuantity: products.availableQuantity,
      leadTimeDays: products.leadTimeDays,
    })
    .from(products)
    .where(and(eq(products.merchantId, merchant.id), eq(products.active, true)));
  const policy = await loadActiveMerchantPolicy(binding, merchant.id);
  return {
    merchant: { id: merchant.id, name: merchant.name, slug: merchant.slug, currency: 'INR' },
    verticals: ['corporate_gifting'],
    catalog: catalog.map(({ tagsJson, ...item }) => ({
      ...item,
      tags: JSON.parse(tagsJson) as string[],
    })),
    buyingLimits: {
      minimumQuantity: 10,
      maximumQuantity: 10_000,
      minimumUnitPaise: 10_000,
      maximumUnitPaise: 10_000_000,
      supportedConstraints: ['vegan', 'plastic-free', 'branded', 'multi-city'],
    },
    policy: {
      version: policy.version,
      automaticNegotiationConcessionBps: policy.maximumAutomaticConcessionBps,
      deeperConcessions: 'merchant_approval_required',
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

export async function getAgentDealSnapshot(binding: D1Database, dealId: string) {
  const workspace = await loadDealQuoteWorkspace(binding, dealId);
  if (!workspace) throw new QuoteWorkflowError('DEAL_NOT_FOUND', 'Deal unavailable.', 404);
  const history = await loadDealQuotes(binding, dealId);
  const currentQuote = history.find(
    (quote) => quote.status === 'buyer_accepted' || quote.status === 'merchant_approved',
  );
  const payment = await loadDealPaymentState(binding, dealId);
  const stage = payment.stage === 'refunded'
    ? 'refunded'
    : payment.stage === 'refund_pending'
      ? 'refund_pending'
      : payment.stage === 'replacement_offered'
        ? 'recovery_offer_pending'
        : payment.stage === 'paid'
          ? 'paid'
          : payment.stage === 'payment_pending'
            ? 'payment_pending'
            : currentQuote?.status === 'buyer_accepted'
              ? 'accepted'
    : currentQuote?.status === 'merchant_approved'
      ? 'ready_to_accept'
      : workspace.result.status === 'rejected'
        ? 'not_fulfillable'
        : 'awaiting_merchant_approval';
  return {
    deal: {
      id: workspace.deal.id,
      publicToken: workspace.deal.publicToken,
      stage,
      mandate: {
        quantity: workspace.deal.quantity,
        maxUnitPaise: workspace.deal.maxUnitPaise,
        hardConstraints: workspace.deal.hardConstraints,
        deliveryLocations: workspace.deal.deliveryLocations,
        deadline: workspace.deal.deadline,
      },
      dealRoomPath: `/deal/${workspace.deal.publicToken}`,
    },
    options: workspace.result.status === 'generated'
      ? workspace.result.options.map((option) => {
          return {
            key: option.key,
            label: option.label,
            rationale: option.rationale,
            unitTotalPaise: option.unitTotalPaise,
            orderTotalPaise: option.orderTotalPaise,
            headroomPaise: option.headroomPaise,
            lines: option.lines.map((line) => ({
              code: line.code,
              label: line.label,
              kind: line.kind,
              unitPricePaise: line.unitPricePaise,
            })),
            checks: option.checks,
          };
        })
      : [],
    rejectionReasons: workspace.result.status === 'rejected' ? workspace.result.reasons : [],
    currentQuote: currentQuote
      ? {
          id: currentQuote.id,
          version: currentQuote.version,
          label: currentQuote.label,
          unitTotalPaise: currentQuote.unitTotalPaise,
          orderTotalPaise: currentQuote.orderTotalPaise,
          quoteHash: currentQuote.quoteHash,
          policyVersion: currentQuote.policyVersion,
          expiresAt: currentQuote.expiresAt,
          status: currentQuote.status,
          checks: currentQuote.checks,
      }
      : null,
    payment: {
      stage: payment.stage,
      order: payment.order
        ? {
            providerOrderId: payment.order.providerOrderId,
            provider: payment.order.provider,
            amountPaise: payment.order.amountPaise,
            currency: payment.order.currency,
            status: payment.order.status,
          }
        : null,
      providerPaymentId: payment.payment?.providerPaymentId ?? null,
      refund: payment.refund,
    },
  };
}

export async function submitAgentCounteroffer(
  binding: D1Database,
  dealId: string,
  input: { expectedQuoteHash: string; targetUnitPaise: number; buyerMessage: string },
) {
  const [deal] = await getDatabase(binding)
    .select({ publicToken: deals.publicToken })
    .from(deals)
    .where(eq(deals.id, dealId))
    .limit(1);
  if (!deal) throw new QuoteWorkflowError('DEAL_NOT_FOUND', 'Deal unavailable.', 404);
  return submitBoundedCounteroffer(binding, deal.publicToken, {
    ...input,
    sourceKind: 'natural_language',
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

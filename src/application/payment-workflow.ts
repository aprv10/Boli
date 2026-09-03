import { z } from 'zod';
import {
  configuredPaymentProvider,
  createProviderOrder,
  createProviderRefund,
  fetchRazorpayPayment,
  PaymentProviderError,
  sha256Text,
  verifyHmacSha256,
  webhookSecret,
  type PaymentProvider,
} from '@/src/adapters/payments/razorpay';
import { prepareAuditBatch } from './audit-ledger';
import { loadActiveMerchantPolicy } from './policy-gate';
import { loadPublicDealRoom, QuoteWorkflowError, type StoredQuote } from './quote-workflow';
import { evaluateCommerceAction } from '@/src/domain/policies/commerce-policy';
import { reconcileCapturedPayment } from '@/src/domain/payments/reconciliation';

const RESERVATION_LIFETIME_MS = 30 * 60 * 1_000;
const WEBHOOK_RETRY_LEASE_MS = 30 * 1_000;

export class PaymentWorkflowError extends QuoteWorkflowError {}

export type DealPaymentState = {
  stage:
    | 'not_ready'
    | 'ready_to_checkout'
    | 'payment_pending'
    | 'paid'
    | 'replacement_offered'
    | 'replacement_accepted'
    | 'buyer_declined'
    | 'refund_pending'
    | 'refunded';
  order: null | {
    id: string;
    quoteId: string;
    providerOrderId: string;
    provider: PaymentProvider;
    checkoutKeyId: string | null;
    amountPaise: number;
    currency: string;
    status: 'created' | 'paid' | 'refund_pending' | 'refunded';
    createdAt: string;
  };
  payment: null | {
    id: string;
    providerPaymentId: string;
    amountPaise: number;
    status: 'captured' | 'partially_refunded' | 'refunded';
    capturedAt: string;
  };
  refund: null | {
    id: string;
    providerRefundId: string | null;
    amountPaise: number;
    status: 'pending' | 'processed' | 'failed' | 'reconciliation_required';
    createdAt: string;
  };
  incident: null | {
    id: string;
    status: 'replacement_offered' | 'buyer_declined' | 'refund_pending' | 'refunded';
    failureCode: string;
    explanation: string;
    replacement: {
      failedProduct: string;
      blockedSubstitute: string;
      compliantReplacement: string;
      buyerImpact: string;
    };
    createdAt: string;
    acceptedAt: string | null;
  };
};

type OrderRow = NonNullable<DealPaymentState['order']> & {
  dealId: string;
  quoteId: string;
  quoteHash: string;
  mandateHash: string;
  policyVersion: number;
  paymentActionId: string;
};

const paymentCapturedWebhookSchema = z.object({
  event: z.literal('payment.captured'),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: z.string().min(4).max(120),
        order_id: z.string().min(4).max(120),
        amount: z.number().int().positive(),
        currency: z.literal('INR'),
        status: z.literal('captured'),
      }),
    }),
  }),
});

const refundWebhookSchema = z.object({
  event: z.enum(['refund.processed', 'refund.failed']),
  payload: z.object({
    refund: z.object({
      entity: z.object({
        id: z.string().min(4).max(120),
        payment_id: z.string().min(4).max(120),
        amount: z.number().int().positive(),
        currency: z.literal('INR'),
        status: z.enum(['processed', 'failed']),
      }),
    }),
  }),
});

function paymentStage(state: Omit<DealPaymentState, 'stage'>): DealPaymentState['stage'] {
  if (state.incident?.status === 'refunded' || state.order?.status === 'refunded') return 'refunded';
  if (state.incident?.status === 'refund_pending' || state.order?.status === 'refund_pending') {
    return 'refund_pending';
  }
  if (state.incident?.status === 'buyer_declined') return 'buyer_declined';
  if (state.incident?.acceptedAt) return 'replacement_accepted';
  if (state.incident?.status === 'replacement_offered') return 'replacement_offered';
  if (state.payment?.status === 'captured' || state.order?.status === 'paid') return 'paid';
  if (state.order) return 'payment_pending';
  return 'not_ready';
}

export async function loadDealPaymentState(
  binding: D1Database,
  dealId: string,
): Promise<DealPaymentState> {
  const order = await binding
    .prepare(
      `SELECT id, payment_action_id AS paymentActionId, deal_id AS dealId,
        quote_id AS quoteId, quote_hash AS quoteHash, mandate_hash AS mandateHash,
        policy_version AS policyVersion, provider_order_id AS providerOrderId,
        provider, checkout_key_id AS checkoutKeyId, amount_paise AS amountPaise,
        currency, status, created_at AS createdAt
       FROM razorpay_orders WHERE deal_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(dealId)
    .first<OrderRow>();
  const payment = order
    ? await binding
        .prepare(
          `SELECT id, provider_payment_id AS providerPaymentId, amount_paise AS amountPaise,
            status, captured_at AS capturedAt
           FROM razorpay_payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(order.id)
        .first<NonNullable<DealPaymentState['payment']>>()
    : null;
  const refund = payment
    ? await binding
        .prepare(
          `SELECT id, provider_refund_id AS providerRefundId, amount_paise AS amountPaise,
            status, created_at AS createdAt
           FROM refunds WHERE payment_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(payment.id)
        .first<NonNullable<DealPaymentState['refund']>>()
    : null;
  const incidentRow = await binding
    .prepare(
      `SELECT id, status, failure_code AS failureCode, explanation,
        replacement_json AS replacementJson, accepted_at AS acceptedAt, created_at AS createdAt
       FROM fulfilment_incidents WHERE deal_id = ? LIMIT 1`,
    )
    .bind(dealId)
    .first<Omit<NonNullable<DealPaymentState['incident']>, 'replacement'> & { replacementJson: string }>();
  const incident = incidentRow
    ? {
        id: incidentRow.id,
        status: incidentRow.status,
        failureCode: incidentRow.failureCode,
        explanation: incidentRow.explanation,
        replacement: JSON.parse(incidentRow.replacementJson) as NonNullable<
          DealPaymentState['incident']
        >['replacement'],
        createdAt: incidentRow.createdAt,
        acceptedAt: incidentRow.acceptedAt,
      }
    : null;
  const withoutStage = { order: order ?? null, payment: payment ?? null, refund: refund ?? null, incident };
  return { ...withoutStage, stage: paymentStage(withoutStage) };
}

export async function loadPublicPaymentState(binding: D1Database, publicToken: string) {
  const deal = await binding
    .prepare('SELECT id FROM deals WHERE public_token = ?')
    .bind(publicToken)
    .first<{ id: string }>();
  if (!deal) return undefined;
  const state = await loadDealPaymentState(binding, deal.id);
  if (state.stage === 'not_ready') {
    const quote = await binding
      .prepare("SELECT id FROM quotes WHERE deal_id = ? AND status = 'buyer_accepted' LIMIT 1")
      .bind(deal.id)
      .first();
    if (quote) state.stage = 'ready_to_checkout';
  }
  return state;
}

async function liveInventory(binding: D1Database, quote: StoredQuote) {
  const productLines = quote.lines.filter(
    (line): line is typeof line & { productId: string } =>
      line.kind === 'product' && typeof line.productId === 'string',
  );
  const results = await binding.batch(
    productLines.map((line) =>
      binding
        .prepare(
          `SELECT id, available_quantity AS availableQuantity,
            reserved_quantity AS reservedQuantity, inventory_version AS inventoryVersion
           FROM products WHERE id = ? AND active = 1`,
        )
        .bind(line.productId),
    ),
  );
  const products = results.map((result) => result.results[0] as {
    id: string;
    availableQuantity: number;
    reservedQuantity: number;
    inventoryVersion: number;
  } | undefined);
  return {
    available:
      products.length === productLines.length &&
      products.every(
        (product) =>
          product && product.availableQuantity - product.reservedQuantity >= quote.quantity,
      ),
    products: products.filter((product): product is NonNullable<typeof product> => Boolean(product)),
  };
}

async function releaseQuoteReservations(binding: D1Database, quoteId: string) {
  const reservations = await binding
    .prepare(
      `SELECT product_id AS productId, quantity FROM inventory_reservations
       WHERE quote_id = ? AND status = 'reserved'`,
    )
    .bind(quoteId)
    .all<{ productId: string; quantity: number }>();
  if (!reservations.results.length) return;
  await binding.batch([
    ...reservations.results.map((reservation) =>
      binding
        .prepare(
          `UPDATE products SET reserved_quantity = MAX(0, reserved_quantity - ?),
            inventory_version = inventory_version + 1 WHERE id = ?`,
        )
        .bind(reservation.quantity, reservation.productId),
    ),
    binding
      .prepare("DELETE FROM inventory_reservations WHERE quote_id = ? AND status = 'reserved'")
      .bind(quoteId),
  ]);
}

async function claimWebhookEvent(
  binding: D1Database,
  input: { eventId: string; eventType: string; payloadHash: string; now: string },
): Promise<{ acquired: true } | { acquired: false; status: string }> {
  const claim = await binding
    .prepare(
      `INSERT OR IGNORE INTO webhook_inbox (
        id, event_type, signature_verified, payload_hash, status, received_at
      ) VALUES (?, ?, 1, ?, 'received', ?)`,
    )
    .bind(input.eventId, input.eventType, input.payloadHash, input.now)
    .run();
  if ((claim.meta.changes ?? 0) === 1) return { acquired: true };

  const existing = await binding
    .prepare(
      `SELECT status, payload_hash AS payloadHash, received_at AS receivedAt
       FROM webhook_inbox WHERE id = ?`,
    )
    .bind(input.eventId)
    .first<{ status: string; payloadHash: string; receivedAt: string }>();
  if (!existing) return { acquired: false, status: 'received' };
  if (existing.payloadHash !== input.payloadHash) {
    throw new PaymentWorkflowError(
      'WEBHOOK_EVENT_CONFLICT',
      'This webhook event ID was already used for a different payload.',
      409,
    );
  }
  if (existing.status !== 'received') {
    return { acquired: false, status: existing.status };
  }

  const leaseAge = Date.parse(input.now) - Date.parse(existing.receivedAt);
  if (Number.isFinite(leaseAge) && leaseAge >= 0 && leaseAge < WEBHOOK_RETRY_LEASE_MS) {
    return { acquired: false, status: existing.status };
  }
  const reacquired = await binding
    .prepare(
      `UPDATE webhook_inbox SET received_at = ?
       WHERE id = ? AND status = 'received' AND received_at = ?`,
    )
    .bind(input.now, input.eventId, existing.receivedAt)
    .run();
  return (reacquired.meta.changes ?? 0) === 1
    ? { acquired: true }
    : { acquired: false, status: 'received' };
}

async function existingCheckout(
  binding: D1Database,
  quoteId: string,
  idempotencyKey: string,
) {
  const keyOwner = await binding
    .prepare('SELECT deal_id AS dealId, quote_id AS quoteId, action_type AS actionType FROM payment_actions WHERE idempotency_key = ?')
    .bind(idempotencyKey)
    .first<{ dealId: string; quoteId: string; actionType: string }>();
  if (keyOwner && (keyOwner.quoteId !== quoteId || keyOwner.actionType !== 'create_order')) {
    throw new PaymentWorkflowError(
      'IDEMPOTENCY_KEY_CONFLICT',
      'That idempotency key already belongs to another money action.',
      409,
    );
  }
  const order = await binding
    .prepare('SELECT id FROM razorpay_orders WHERE quote_id = ? LIMIT 1')
    .bind(quoteId)
    .first<{ id: string }>();
  if (!order && keyOwner) {
    throw new PaymentWorkflowError(
      'PAYMENT_RECONCILIATION_PENDING',
      'The existing checkout action has not reached a final provider state.',
      202,
    );
  }
  return order;
}

export async function createCheckoutOrder(
  binding: D1Database,
  publicToken: string,
  expectedQuoteHash: string,
  idempotencyKey: string,
  now = new Date().toISOString(),
) {
  const room = await loadPublicDealRoom(binding, publicToken);
  if (!room) throw new PaymentWorkflowError('DEAL_NOT_FOUND', 'This Deal Room does not exist.', 404);
  const quote = room.currentQuote;
  if (!quote || quote.status !== 'buyer_accepted') {
    throw new PaymentWorkflowError(
      'QUOTE_NOT_ACCEPTED',
      'Accept the exact merchant-approved quote before creating checkout.',
      409,
    );
  }
  if (await existingCheckout(binding, quote.id, idempotencyKey)) {
    return { state: await loadDealPaymentState(binding, room.deal.id), reused: true };
  }

  const inventory = await liveInventory(binding, quote);
  const policy = await loadActiveMerchantPolicy(binding, room.deal.merchantId);
  const decision = evaluateCommerceAction({
    action: 'create_checkout',
    policy,
    now,
    buyerMaxUnitPaise: room.deal.maxUnitPaise,
    expectedQuoteHash,
    inventoryAvailable: inventory.available,
    quote: {
      status: quote.status,
      unitTotalPaise: quote.unitTotalPaise,
      contributionMarginBps: quote.contributionMarginBps,
      expiresAt: quote.expiresAt,
      quoteHash: quote.quoteHash,
      checks: quote.checks,
    },
  });
  if (!decision.allowed) {
    throw new PaymentWorkflowError(
      'CHECKOUT_POLICY_REJECTED',
      `Checkout was blocked: ${decision.reasonCodes.join(', ')}.`,
      409,
    );
  }

  const actionId = crypto.randomUUID();
  const provider = configuredPaymentProvider();
  const expiresAt = new Date(Date.parse(now) + RESERVATION_LIFETIME_MS).toISOString();
  const productLines = quote.lines.filter(
    (line): line is typeof line & { productId: string } =>
      line.kind === 'product' && typeof line.productId === 'string',
  );
  const inventoryById = new Map(inventory.products.map((product) => [product.id, product]));
  const reservationResults = await binding.batch([
    binding
      .prepare(
        `INSERT INTO payment_actions (
          id, deal_id, quote_id, idempotency_key, action_type, amount_paise,
          status, provider, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'create_order', ?, 'pending', ?, ?, ?)`,
      )
      .bind(
        actionId,
        room.deal.id,
        quote.id,
        idempotencyKey,
        quote.orderTotalPaise,
        provider,
        now,
        now,
      ),
    ...productLines.flatMap((line) => {
      const product = inventoryById.get(line.productId)!;
      const reservationId = crypto.randomUUID();
      return [
        binding
          .prepare(
            `UPDATE products SET reserved_quantity = reserved_quantity + ?,
              inventory_version = inventory_version + 1
             WHERE id = ? AND inventory_version = ?
             AND available_quantity - reserved_quantity >= ?`,
          )
          .bind(quote.quantity, line.productId, product.inventoryVersion, quote.quantity),
        binding
          .prepare(
            `INSERT INTO inventory_reservations (
              id, quote_id, product_id, quantity, status, expires_at, created_at, updated_at
            ) SELECT ?, ?, ?, ?, 'reserved', ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM products WHERE id = ? AND inventory_version = ?
            )`,
          )
          .bind(
            reservationId,
            quote.id,
            line.productId,
            quote.quantity,
            expiresAt,
            now,
            now,
            line.productId,
            product.inventoryVersion + 1,
          ),
      ];
    }),
  ]);
  const failedReservation = productLines.some((_, index) => {
    const updateResult = reservationResults[1 + index * 2];
    const insertResult = reservationResults[2 + index * 2];
    return (updateResult.meta.changes ?? 0) !== 1 || (insertResult.meta.changes ?? 0) !== 1;
  });
  if (failedReservation) {
    await releaseQuoteReservations(binding, quote.id);
    const audit = await prepareAuditBatch(binding, room.deal.id, [
      {
        id: crypto.randomUUID(),
        quoteId: quote.id,
        eventType: 'checkout_blocked',
        actorType: 'system',
        summary: 'Checkout stopped because inventory changed during reservation.',
        data: { paymentActionId: actionId, reasonCodes: ['INVENTORY_CHANGED'] },
        createdAt: now,
      },
    ]);
    await binding.batch([
      binding
        .prepare(
          `UPDATE payment_actions SET status = 'failed', failure_code = 'INVENTORY_CHANGED',
            updated_at = ? WHERE id = ?`,
        )
        .bind(now, actionId),
      ...audit.statements,
    ]);
    throw new PaymentWorkflowError(
      'INVENTORY_CHANGED',
      'Inventory changed during reservation. No provider order was created.',
      409,
    );
  }

  let providerOrder;
  try {
    providerOrder = await createProviderOrder({
      actionId,
      amountPaise: quote.orderTotalPaise,
      receipt: `boli-${room.deal.id.slice(0, 8)}-${quote.version}`,
      notes: {
        boli_deal_id: room.deal.id,
        quote_hash: quote.quoteHash,
        mandate_hash: quote.intentHash,
        policy_version: String(quote.policyVersion),
      },
    });
  } catch (error) {
    const providerError = error instanceof PaymentProviderError ? error : undefined;
    const status = providerError?.reconciliationRequired ? 'reconciliation_required' : 'failed';
    if (status === 'failed') await releaseQuoteReservations(binding, quote.id);
    const audit = await prepareAuditBatch(binding, room.deal.id, [
      {
        id: crypto.randomUUID(),
        quoteId: quote.id,
        eventType:
          status === 'reconciliation_required'
            ? 'checkout_reconciliation_required'
            : 'checkout_provider_rejected',
        actorType: 'system',
        summary:
          status === 'reconciliation_required'
            ? 'Provider outcome is unknown; Boli preserved the reservation for reconciliation.'
            : 'Provider rejected checkout; Boli released the reservation.',
        data: {
          paymentActionId: actionId,
          reasonCodes: [providerError?.code ?? 'PROVIDER_UNAVAILABLE'],
        },
        createdAt: now,
      },
    ]);
    await binding.batch([
      binding
        .prepare(
          `UPDATE payment_actions SET status = ?, failure_code = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(status, providerError?.code ?? 'PROVIDER_UNAVAILABLE', now, actionId),
      ...audit.statements,
    ]);
    throw new PaymentWorkflowError(
      status === 'reconciliation_required' ? 'PAYMENT_RECONCILIATION_PENDING' : 'PROVIDER_UNAVAILABLE',
      providerError?.message ?? 'The payment provider is unavailable.',
      status === 'reconciliation_required' ? 202 : 503,
    );
  }

  const orderId = crypto.randomUUID();
  const audit = await prepareAuditBatch(binding, room.deal.id, [
    {
      id: crypto.randomUUID(),
      quoteId: quote.id,
      eventType: 'checkout_order_created',
      actorType: 'buyer',
      summary: `Created a ${providerOrder.provider === 'demo' ? 'signed demo' : 'Razorpay test'} order for the exact accepted quote.`,
      data: {
        paymentActionId: actionId,
        providerOrderId: providerOrder.providerOrderId,
        amountPaise: quote.orderTotalPaise,
        currency: 'INR',
        quoteHash: quote.quoteHash,
        policyVersion: quote.policyVersion,
        checks: decision.checks,
        reasonCodes: decision.reasonCodes,
      },
      createdAt: now,
    },
  ]);
  await binding.batch([
    binding
      .prepare(
        `INSERT INTO razorpay_orders (
          id, payment_action_id, deal_id, quote_id, quote_hash, mandate_hash,
          policy_version, provider_order_id, provider, checkout_key_id,
          amount_paise, currency, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', 'created', ?, ?)`,
      )
      .bind(
        orderId,
        actionId,
        room.deal.id,
        quote.id,
        quote.quoteHash,
        quote.intentHash,
        quote.policyVersion,
        providerOrder.providerOrderId,
        providerOrder.provider,
        providerOrder.checkoutKeyId,
        quote.orderTotalPaise,
        now,
        now,
      ),
    binding
      .prepare(
        `UPDATE payment_actions SET status = 'succeeded', provider_reference = ?,
          updated_at = ? WHERE id = ? AND status = 'pending'`,
      )
      .bind(providerOrder.providerOrderId, now, actionId),
    ...audit.statements,
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, room.deal.id),
  ]);
  return { state: await loadDealPaymentState(binding, room.deal.id), reused: false };
}

export async function verifyCheckoutCallback(
  binding: D1Database,
  input: { providerOrderId: string; providerPaymentId: string; signature: string },
  secret: string,
  now = new Date().toISOString(),
) {
  const order = await binding
    .prepare(
      `SELECT id, payment_action_id AS paymentActionId, deal_id AS dealId,
        quote_id AS quoteId, provider_order_id AS providerOrderId,
        amount_paise AS amountPaise, currency, status
       FROM razorpay_orders WHERE provider_order_id = ? AND provider = 'razorpay'`,
    )
    .bind(input.providerOrderId)
    .first<{
      id: string;
      paymentActionId: string;
      dealId: string;
      quoteId: string;
      providerOrderId: string;
      amountPaise: number;
      currency: string;
      status: string;
    }>();
  if (!order) throw new PaymentWorkflowError('ORDER_NOT_FOUND', 'Checkout order unavailable.', 404);
  const verified = await verifyHmacSha256(
    `${order.providerOrderId}|${input.providerPaymentId}`,
    input.signature,
    secret,
  );
  if (!verified) {
    throw new PaymentWorkflowError('CHECKOUT_SIGNATURE_INVALID', 'Checkout signature is invalid.', 401);
  }
  const payloadHash = await sha256Text(`${order.providerOrderId}|${input.providerPaymentId}`);
  const existing = await binding
    .prepare('SELECT id FROM checkout_callbacks WHERE provider_payment_id = ?')
    .bind(input.providerPaymentId)
    .first();
  if (!existing) {
    const callbackAudit = await prepareAuditBatch(binding, order.dealId, [
      {
        id: crypto.randomUUID(),
        quoteId: order.quoteId,
        eventType: 'checkout_signature_verified',
        actorType: 'system',
        summary: 'Verified the signed Razorpay Checkout response.',
        data: { providerOrderId: order.providerOrderId, providerPaymentId: input.providerPaymentId },
        createdAt: now,
      },
    ]);
    await binding.batch([
      binding
        .prepare(
          `INSERT INTO checkout_callbacks (
            id, order_id, provider_payment_id, signature_verified, payload_hash, created_at
          ) VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .bind(crypto.randomUUID(), order.id, input.providerPaymentId, payloadHash, now),
      ...callbackAudit.statements,
    ]);
  }

  const providerPayment = await fetchRazorpayPayment(input.providerPaymentId);
  const reconciliation = reconcileCapturedPayment({
    expected: {
      providerOrderId: order.providerOrderId,
      amountPaise: order.amountPaise,
      currency: 'INR',
    },
    observed: {
      providerOrderId: providerPayment.providerOrderId,
      amountPaise: providerPayment.amountPaise,
      currency: providerPayment.currency,
      status: providerPayment.status,
    },
  });
  const factMismatch = reconciliation.checks.some(
    (check) => check.code !== 'PAYMENT_CAPTURED' && !check.passed,
  );
  if (factMismatch) {
    throw new PaymentWorkflowError(
      'PAYMENT_FACT_MISMATCH',
      'Razorpay payment facts do not match the accepted order.',
      409,
    );
  }
  if (providerPayment.status !== 'captured') {
    return {
      verified: true,
      confirmed: false,
      providerStatus: providerPayment.status,
      awaitingWebhook: true,
      duplicate: Boolean(existing),
    };
  }

  const existingPayment = await binding
    .prepare('SELECT id FROM razorpay_payments WHERE provider_payment_id = ?')
    .bind(providerPayment.providerPaymentId)
    .first();
  if (existingPayment || order.status === 'paid') {
    return {
      verified: true,
      confirmed: true,
      providerStatus: providerPayment.status,
      awaitingWebhook: false,
      duplicate: true,
    };
  }
  const paymentAudit = await prepareAuditBatch(binding, order.dealId, [
    {
      id: crypto.randomUUID(),
      quoteId: order.quoteId,
      eventType: 'payment_captured',
      actorType: 'system',
      summary: 'Reconciled the captured payment with Razorpay and marked the exact order paid.',
      data: {
        source: 'provider_api_after_checkout',
        providerOrderId: providerPayment.providerOrderId,
        providerPaymentId: providerPayment.providerPaymentId,
        amountPaise: providerPayment.amountPaise,
        currency: providerPayment.currency,
        checks: reconciliation.checks,
        reasonCodes: reconciliation.reasonCodes,
      },
      createdAt: now,
    },
  ]);
  await binding.batch([
    binding
      .prepare(
        `INSERT INTO razorpay_payments (
          id, order_id, provider_payment_id, amount_paise, currency,
          status, captured_at, created_at
        ) VALUES (?, ?, ?, ?, 'INR', 'captured', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        order.id,
        providerPayment.providerPaymentId,
        providerPayment.amountPaise,
        now,
        now,
      ),
    binding
      .prepare("UPDATE razorpay_orders SET status = 'paid', updated_at = ? WHERE id = ? AND status = 'created'")
      .bind(now, order.id),
    ...paymentAudit.statements,
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, order.dealId),
  ]);
  return {
    verified: true,
    confirmed: true,
    providerStatus: providerPayment.status,
    awaitingWebhook: false,
    duplicate: false,
  };
}

export async function processPaymentCapturedWebhook(
  binding: D1Database,
  input: { rawBody: string; signature: string; eventId: string; secret: string },
  now = new Date().toISOString(),
) {
  if (!(await verifyHmacSha256(input.rawBody, input.signature, input.secret))) {
    throw new PaymentWorkflowError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature is invalid.', 401);
  }
  if (!/^[A-Za-z0-9_-]{4,160}$/.test(input.eventId)) {
    throw new PaymentWorkflowError('WEBHOOK_EVENT_ID_INVALID', 'Webhook event ID is invalid.', 400);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    payload = null;
  }
  const parsed = paymentCapturedWebhookSchema.safeParse(payload);
  const payloadHash = await sha256Text(input.rawBody);
  const claim = await claimWebhookEvent(binding, {
    eventId: input.eventId,
    eventType: parsed.success ? parsed.data.event : 'unsupported',
    payloadHash,
    now,
  });
  if (!claim.acquired) {
    if (claim.status === 'received') {
      throw new PaymentWorkflowError(
        'WEBHOOK_PROCESSING_INCOMPLETE',
        'Webhook processing is incomplete; the provider should retry delivery.',
        503,
      );
    }
    return { duplicate: true, status: claim.status };
  }
  if (!parsed.success) {
    await binding
      .prepare(
        `UPDATE webhook_inbox SET status = 'rejected',
          failure_code = 'INVALID_WEBHOOK_PAYLOAD', processed_at = ? WHERE id = ?`,
      )
      .bind(now, input.eventId)
      .run();
    throw new PaymentWorkflowError('INVALID_WEBHOOK_PAYLOAD', 'Webhook payload is unsupported.', 400);
  }
  const entity = parsed.data.payload.payment.entity;
  const order = await binding
    .prepare(
      `SELECT id, payment_action_id AS paymentActionId, deal_id AS dealId,
        quote_id AS quoteId, provider_order_id AS providerOrderId,
        amount_paise AS amountPaise, currency, status
       FROM razorpay_orders WHERE provider_order_id = ?`,
    )
    .bind(entity.order_id)
    .first<{
      id: string;
      paymentActionId: string;
      dealId: string;
      quoteId: string;
      providerOrderId: string;
      amountPaise: number;
      currency: string;
      status: string;
    }>();
  const reconciliation = order
    ? reconcileCapturedPayment({
        expected: {
          providerOrderId: order.providerOrderId,
          amountPaise: order.amountPaise,
          currency: 'INR',
        },
        observed: {
          providerOrderId: entity.order_id,
          amountPaise: entity.amount,
          currency: entity.currency,
          status: entity.status,
        },
      })
    : null;
  if (!order || !reconciliation?.allowed) {
    await binding
      .prepare(
        `UPDATE webhook_inbox SET status = 'rejected',
          failure_code = 'PAYMENT_FACT_MISMATCH', processed_at = ? WHERE id = ?`,
      )
      .bind(now, input.eventId)
      .run();
    throw new PaymentWorkflowError(
      'PAYMENT_FACT_MISMATCH',
      'Captured payment facts do not match the accepted order.',
      409,
    );
  }
  const existingPayment = await binding
    .prepare('SELECT id FROM razorpay_payments WHERE provider_payment_id = ?')
    .bind(entity.id)
    .first();
  if (existingPayment) {
    await binding
      .prepare(
        `UPDATE webhook_inbox SET status = 'processed', processed_at = ? WHERE id = ?`,
      )
      .bind(now, input.eventId)
      .run();
    return { duplicate: true, status: 'processed' };
  }
  const audit = await prepareAuditBatch(binding, order.dealId, [
    {
      id: crypto.randomUUID(),
      quoteId: order.quoteId,
      eventType: 'payment_captured',
      actorType: 'system',
      summary: 'Verified the raw-body webhook and marked the exact order paid.',
      data: {
        webhookEventId: input.eventId,
        providerOrderId: entity.order_id,
        providerPaymentId: entity.id,
        amountPaise: entity.amount,
        currency: entity.currency,
        checks: reconciliation?.checks ?? [],
        reasonCodes: reconciliation?.reasonCodes ?? ['PAYMENT_ORDER_NOT_FOUND'],
      },
      createdAt: now,
    },
  ]);
  await binding.batch([
    binding
      .prepare(
        `UPDATE webhook_inbox SET status = 'processed', processed_at = ? WHERE id = ?`,
      )
      .bind(now, input.eventId),
    binding
      .prepare(
        `INSERT INTO razorpay_payments (
          id, order_id, provider_payment_id, amount_paise, currency,
          status, captured_at, created_at
        ) VALUES (?, ?, ?, ?, 'INR', 'captured', ?, ?)`,
      )
      .bind(crypto.randomUUID(), order.id, entity.id, entity.amount, now, now),
    binding
      .prepare("UPDATE razorpay_orders SET status = 'paid', updated_at = ? WHERE id = ? AND status = 'created'")
      .bind(now, order.id),
    ...audit.statements,
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, order.dealId),
  ]);
  return { duplicate: false, status: 'processed' };
}

async function processRefundWebhook(
  binding: D1Database,
  input: { rawBody: string; signature: string; eventId: string; secret: string },
  now = new Date().toISOString(),
) {
  if (!(await verifyHmacSha256(input.rawBody, input.signature, input.secret))) {
    throw new PaymentWorkflowError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature is invalid.', 401);
  }
  if (!/^[A-Za-z0-9_-]{4,160}$/.test(input.eventId)) {
    throw new PaymentWorkflowError('WEBHOOK_EVENT_ID_INVALID', 'Webhook event ID is invalid.', 400);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    payload = null;
  }
  const parsed = refundWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    throw new PaymentWorkflowError('INVALID_WEBHOOK_PAYLOAD', 'Refund webhook is malformed.', 400);
  }
  const payloadHash = await sha256Text(input.rawBody);
  const claim = await claimWebhookEvent(binding, {
    eventId: input.eventId,
    eventType: parsed.data.event,
    payloadHash,
    now,
  });
  if (!claim.acquired) {
    if (claim.status === 'received') {
      throw new PaymentWorkflowError(
        'WEBHOOK_PROCESSING_INCOMPLETE',
        'Webhook processing is incomplete; the provider should retry delivery.',
        503,
      );
    }
    return { duplicate: true, status: claim.status };
  }
  const entity = parsed.data.payload.refund.entity;
  const row = await binding
    .prepare(
      `SELECT r.id, r.status AS refundStatus, r.amount_paise AS refundAmountPaise,
        r.payment_action_id AS paymentActionId, p.id AS paymentId,
        p.provider_payment_id AS providerPaymentId, p.amount_paise AS capturedAmountPaise,
        o.id AS orderId, o.deal_id AS dealId, o.quote_id AS quoteId
       FROM refunds r
       JOIN razorpay_payments p ON p.id = r.payment_id
       JOIN razorpay_orders o ON o.id = p.order_id
       WHERE r.provider_refund_id = ?
          OR (p.provider_payment_id = ? AND r.amount_paise = ?
            AND r.status IN ('pending', 'reconciliation_required'))
       ORDER BY r.created_at DESC LIMIT 1`,
    )
    .bind(entity.id, entity.payment_id, entity.amount)
    .first<{
      id: string;
      refundStatus: string;
      refundAmountPaise: number;
      paymentActionId: string;
      paymentId: string;
      providerPaymentId: string;
      capturedAmountPaise: number;
      orderId: string;
      dealId: string;
      quoteId: string;
    }>();
  const factsMatch = Boolean(
    row &&
      row.providerPaymentId === entity.payment_id &&
      row.refundAmountPaise === entity.amount &&
      entity.amount <= row.capturedAmountPaise &&
      ((parsed.data.event === 'refund.processed' && entity.status === 'processed') ||
        (parsed.data.event === 'refund.failed' && entity.status === 'failed')),
  );
  if (!row || !factsMatch) {
    await binding
      .prepare(
        `UPDATE webhook_inbox SET status = 'rejected',
          failure_code = 'REFUND_FACT_MISMATCH', processed_at = ? WHERE id = ?`,
      )
      .bind(now, input.eventId)
      .run();
    throw new PaymentWorkflowError(
      'REFUND_FACT_MISMATCH',
      'Refund webhook facts do not match a policy-gated refund action.',
      409,
    );
  }
  const processed = parsed.data.event === 'refund.processed' && entity.status === 'processed';
  if (
    (processed && row.refundStatus === 'processed') ||
    (!processed && row.refundStatus === 'failed')
  ) {
    await binding
      .prepare("UPDATE webhook_inbox SET status = 'processed', processed_at = ? WHERE id = ?")
      .bind(now, input.eventId)
      .run();
    return { duplicate: true, status: 'processed' };
  }
  const audit = await prepareAuditBatch(binding, row.dealId, [
    {
      id: crypto.randomUUID(),
      quoteId: row.quoteId,
      eventType: processed ? 'refund_processed' : 'refund_failed',
      actorType: 'system',
      summary: processed
        ? 'Verified the refund webhook and finalized the full refund.'
        : 'Verified the refund failure webhook; no money was marked returned.',
      data: {
        webhookEventId: input.eventId,
        providerRefundId: entity.id,
        providerPaymentId: entity.payment_id,
        amountPaise: entity.amount,
        currency: entity.currency,
      },
      createdAt: now,
    },
  ]);
  await binding.batch([
    binding
      .prepare("UPDATE webhook_inbox SET status = 'processed', processed_at = ? WHERE id = ?")
      .bind(now, input.eventId),
    binding
      .prepare(
        `UPDATE refunds SET provider_refund_id = COALESCE(provider_refund_id, ?),
          status = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(entity.id, processed ? 'processed' : 'failed', now, row.id),
    binding
      .prepare('UPDATE payment_actions SET status = ?, failure_code = ?, updated_at = ? WHERE id = ?')
      .bind(processed ? 'succeeded' : 'failed', processed ? null : 'REFUND_FAILED', now, row.paymentActionId),
    binding
      .prepare('UPDATE razorpay_payments SET status = ? WHERE id = ?')
      .bind(processed ? 'refunded' : 'captured', row.paymentId),
    binding
      .prepare('UPDATE razorpay_orders SET status = ?, updated_at = ? WHERE id = ?')
      .bind(processed ? 'refunded' : 'paid', now, row.orderId),
    binding
      .prepare('UPDATE fulfilment_incidents SET status = ?, updated_at = ? WHERE deal_id = ?')
      .bind(processed ? 'refunded' : 'buyer_declined', now, row.dealId),
    ...audit.statements,
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, row.dealId),
  ]);
  return { duplicate: false, status: 'processed' };
}

export async function processRazorpayWebhook(
  binding: D1Database,
  input: { rawBody: string; signature: string; eventId: string; secret: string },
  now = new Date().toISOString(),
) {
  let event = '';
  try {
    const payload = JSON.parse(input.rawBody) as { event?: unknown };
    if (typeof payload.event === 'string') event = payload.event;
  } catch {
    // The payment handler records a signed malformed payload as rejected.
  }
  if (event === 'refund.processed' || event === 'refund.failed') {
    return processRefundWebhook(binding, input, now);
  }
  return processPaymentCapturedWebhook(binding, input, now);
}

export async function simulateDemoPayment(
  binding: D1Database,
  providerOrderId: string,
  now = new Date().toISOString(),
) {
  if (process.env.NODE_ENV === 'production') {
    throw new PaymentWorkflowError('DEMO_DISABLED', 'Demo payment controls are disabled.', 404);
  }
  const order = await binding
    .prepare(
      `SELECT amount_paise AS amountPaise, currency FROM razorpay_orders
       WHERE provider_order_id = ? AND provider = 'demo'`,
    )
    .bind(providerOrderId)
    .first<{ amountPaise: number; currency: string }>();
  if (!order) throw new PaymentWorkflowError('ORDER_NOT_FOUND', 'Demo order unavailable.', 404);
  const providerPaymentId = `pay_demo_${providerOrderId.replace('order_demo_', '').slice(0, 20)}`;
  const rawBody = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: providerPaymentId,
          order_id: providerOrderId,
          amount: order.amountPaise,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
  });
  const secret = webhookSecret({ allowDemo: true });
  const { hmacSha256Hex } = await import('@/src/adapters/payments/razorpay');
  const signature = await hmacSha256Hex(rawBody, secret);
  return processPaymentCapturedWebhook(
    binding,
    {
      rawBody,
      signature,
      eventId: `evt_demo_${providerOrderId.replaceAll('-', '').slice(0, 24)}`,
      secret,
    },
    now,
  );
}

export async function issueFullRefund(
  binding: D1Database,
  dealId: string,
  idempotencyKey: string,
  reason: string,
  now = new Date().toISOString(),
) {
  const state = await loadDealPaymentState(binding, dealId);
  if (!state.order || !state.payment) {
    throw new PaymentWorkflowError('PAYMENT_NOT_CAPTURED', 'A captured payment is required.', 409);
  }
  const keyOwner = await binding
    .prepare(
      `SELECT id, deal_id AS dealId, action_type AS actionType, status
       FROM payment_actions WHERE idempotency_key = ?`,
    )
    .bind(idempotencyKey)
    .first<{ id: string; dealId: string; actionType: string; status: string }>();
  if (keyOwner && (keyOwner.dealId !== dealId || keyOwner.actionType !== 'refund')) {
    throw new PaymentWorkflowError('IDEMPOTENCY_KEY_CONFLICT', 'That money-action key is already used.', 409);
  }
  if (state.refund && state.refund.status !== 'failed') return { state, reused: true };
  const failedRefundForKey = keyOwner
    ? await binding
        .prepare(
          `SELECT id FROM refunds
           WHERE payment_action_id = ? AND payment_id = ? AND status = 'failed'`,
        )
        .bind(keyOwner.id, state.payment.id)
        .first<{ id: string }>()
    : undefined;
  if (keyOwner && !failedRefundForKey) {
    throw new PaymentWorkflowError(
      'PAYMENT_RECONCILIATION_PENDING',
      'The existing refund action has not reached a safely retryable state.',
      202,
    );
  }

  const deal = await binding
    .prepare(
      `SELECT d.public_token AS publicToken, d.merchant_id AS merchantId,
        pr.max_unit_paise AS maxUnitPaise
       FROM deals d JOIN purchase_requirements pr ON pr.intent_id = d.intent_id
       WHERE d.id = ?`,
    )
    .bind(dealId)
    .first<{ publicToken: string; merchantId: string; maxUnitPaise: number }>();
  if (!deal) throw new PaymentWorkflowError('DEAL_NOT_FOUND', 'Deal unavailable.', 404);
  const room = await loadPublicDealRoom(binding, deal.publicToken);
  const quote = room?.quoteHistory.find((item) => item.id === state.order?.quoteId);
  if (!room || !quote) throw new PaymentWorkflowError('QUOTE_NOT_FOUND', 'Paid quote unavailable.', 404);
  const refunded = await binding
    .prepare(
      `SELECT COALESCE(SUM(amount_paise), 0) AS amountPaise FROM refunds
       WHERE payment_id = ? AND status IN ('pending', 'processed', 'reconciliation_required')`,
    )
    .bind(state.payment.id)
    .first<{ amountPaise: number }>();
  const policy = await loadActiveMerchantPolicy(binding, deal.merchantId);
  const decision = evaluateCommerceAction({
    action: 'issue_refund',
    policy,
    now,
    buyerMaxUnitPaise: deal.maxUnitPaise,
    capturedAmountPaise: state.payment.amountPaise,
    alreadyRefundedPaise: refunded?.amountPaise ?? 0,
    requestedRefundPaise: state.payment.amountPaise,
    quote: {
      status: quote.status,
      unitTotalPaise: quote.unitTotalPaise,
      contributionMarginBps: quote.contributionMarginBps,
      quoteHash: quote.quoteHash,
      checks: quote.checks,
    },
  });
  if (!decision.allowed) {
    throw new PaymentWorkflowError(
      'REFUND_POLICY_REJECTED',
      `Refund was blocked: ${decision.reasonCodes.join(', ')}.`,
      409,
    );
  }

  const actionId = keyOwner?.id ?? crypto.randomUUID();
  const refundId = failedRefundForKey?.id ?? crypto.randomUUID();
  const retryingFailedRefund = Boolean(failedRefundForKey);
  const requestedAudit = await prepareAuditBatch(binding, dealId, [
    {
      id: crypto.randomUUID(),
      quoteId: quote.id,
      eventType: retryingFailedRefund ? 'refund_retried' : 'refund_requested',
      actorType: 'buyer',
      summary: retryingFailedRefund
        ? 'Retried the same policy-gated refund after a definitive provider rejection.'
        : 'Requested one policy-gated full refund after declining the recovery offer.',
      data: {
        paymentActionId: actionId,
        amountPaise: state.payment.amountPaise,
        reason,
        checks: decision.checks,
        reasonCodes: decision.reasonCodes,
      },
      createdAt: now,
    },
  ]);
  const refundRequestStatements = retryingFailedRefund
    ? [
        binding
          .prepare(
            `UPDATE payment_actions SET status = 'pending', failure_code = NULL, updated_at = ?
             WHERE id = ? AND status = 'failed'`,
          )
          .bind(now, actionId),
        binding
          .prepare(
            `UPDATE refunds SET status = 'pending', updated_at = ?
             WHERE id = ? AND status = 'failed'`,
          )
          .bind(now, refundId),
      ]
    : [
        binding
          .prepare(
            `INSERT INTO payment_actions (
              id, deal_id, quote_id, idempotency_key, action_type, amount_paise,
              status, provider, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'refund', ?, 'pending', ?, ?, ?)`,
          )
          .bind(actionId, dealId, quote.id, idempotencyKey, state.payment.amountPaise, state.order.provider, now, now),
        binding
          .prepare(
            `INSERT INTO refunds (
              id, payment_id, payment_action_id, amount_paise, reason,
              status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
          )
          .bind(refundId, state.payment.id, actionId, state.payment.amountPaise, reason, now, now),
      ];
  await binding.batch([
    ...refundRequestStatements,
    binding
      .prepare("UPDATE razorpay_orders SET status = 'refund_pending', updated_at = ? WHERE id = ?")
      .bind(now, state.order.id),
    binding
      .prepare("UPDATE fulfilment_incidents SET status = 'refund_pending', updated_at = ? WHERE deal_id = ?")
      .bind(now, dealId),
    ...requestedAudit.statements,
  ]);

  let providerRefund;
  try {
    providerRefund = await createProviderRefund({
      actionId,
      providerPaymentId: state.payment.providerPaymentId,
      amountPaise: state.payment.amountPaise,
      receipt: `boli-refund-${dealId.slice(0, 8)}`,
      notes: { boli_deal_id: dealId, quote_hash: quote.quoteHash, reason },
      provider: state.order.provider,
    });
  } catch (error) {
    const providerError = error instanceof PaymentProviderError ? error : undefined;
    const status = providerError?.reconciliationRequired ? 'reconciliation_required' : 'failed';
    const audit = await prepareAuditBatch(binding, dealId, [
      {
        id: crypto.randomUUID(),
        quoteId: quote.id,
        eventType:
          status === 'reconciliation_required'
            ? 'refund_reconciliation_required'
            : 'refund_provider_rejected',
        actorType: 'system',
        summary:
          status === 'reconciliation_required'
            ? 'Refund provider outcome is unknown; duplicate refund creation remains blocked.'
            : 'Refund provider rejected the request; no refund was recorded as processed.',
        data: {
          paymentActionId: actionId,
          reasonCodes: [providerError?.code ?? 'PROVIDER_UNAVAILABLE'],
        },
        createdAt: now,
      },
    ]);
    await binding.batch([
      binding
        .prepare('UPDATE refunds SET status = ?, updated_at = ? WHERE id = ?')
        .bind(status, now, refundId),
      binding
        .prepare('UPDATE payment_actions SET status = ?, failure_code = ?, updated_at = ? WHERE id = ?')
        .bind(status, providerError?.code ?? 'PROVIDER_UNAVAILABLE', now, actionId),
      ...(status === 'failed'
        ? [
            binding
              .prepare("UPDATE razorpay_orders SET status = 'paid', updated_at = ? WHERE id = ?")
              .bind(now, state.order.id),
            binding
              .prepare("UPDATE fulfilment_incidents SET status = 'buyer_declined', updated_at = ? WHERE deal_id = ?")
              .bind(now, dealId),
          ]
        : []),
      ...audit.statements,
    ]);
    throw new PaymentWorkflowError(
      status === 'reconciliation_required' ? 'PAYMENT_RECONCILIATION_PENDING' : 'PROVIDER_UNAVAILABLE',
      providerError?.message ?? 'Refund provider unavailable.',
      status === 'reconciliation_required' ? 202 : 503,
    );
  }

  const processed = providerRefund.status === 'processed';
  const completedAudit = await prepareAuditBatch(binding, dealId, [
    {
      id: crypto.randomUUID(),
      quoteId: quote.id,
      eventType: processed ? 'refund_processed' : 'refund_pending',
      actorType: 'system',
      summary: processed
        ? 'Provider processed exactly one full refund.'
        : 'Provider accepted the refund; reconciliation remains pending.',
      data: {
        providerRefundId: providerRefund.providerRefundId,
        amountPaise: state.payment.amountPaise,
        provider: providerRefund.provider,
      },
      createdAt: new Date().toISOString(),
    },
  ]);
  await binding.batch([
    binding
      .prepare('UPDATE refunds SET provider_refund_id = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(providerRefund.providerRefundId, processed ? 'processed' : 'pending', now, refundId),
    binding
      .prepare("UPDATE payment_actions SET status = 'succeeded', provider_reference = ?, updated_at = ? WHERE id = ?")
      .bind(providerRefund.providerRefundId, now, actionId),
    binding
      .prepare('UPDATE razorpay_payments SET status = ? WHERE id = ?')
      .bind(processed ? 'refunded' : 'captured', state.payment.id),
    binding
      .prepare('UPDATE razorpay_orders SET status = ?, updated_at = ? WHERE id = ?')
      .bind(processed ? 'refunded' : 'refund_pending', now, state.order.id),
    ...completedAudit.statements,
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, dealId),
  ]);
  return { state: await loadDealPaymentState(binding, dealId), reused: false };
}

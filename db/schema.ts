import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const merchants = sqliteTable('merchants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status', { enum: ['active', 'inactive'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const merchantPolicyVersions = sqliteTable(
  'merchant_policy_versions',
  {
    id: text('id').primaryKey(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id),
    version: integer('version').notNull(),
    minimumMarginBps: integer('minimum_margin_bps').notNull(),
    maximumAutomaticConcessionBps: integer(
      'maximum_automatic_concession_bps',
    ).notNull(),
    status: text('status', { enum: ['active', 'retired'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_merchant_policy_version').on(
      table.merchantId,
      table.version,
    ),
    index('idx_merchant_policy_active').on(table.merchantId, table.status),
  ],
);

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    tagsJson: text('tags_json').notNull(),
    unitPricePaise: integer('unit_price_paise').notNull(),
    unitCostPaise: integer('unit_cost_paise').notNull(),
    availableQuantity: integer('available_quantity').notNull(),
    reservedQuantity: integer('reserved_quantity').notNull().default(0),
    inventoryVersion: integer('inventory_version').notNull().default(1),
    leadTimeDays: integer('lead_time_days').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_products_merchant_sku').on(table.merchantId, table.sku),
    index('idx_products_merchant_active').on(table.merchantId, table.active),
  ],
);

export const purchaseIntents = sqliteTable(
  'purchase_intents',
  {
    id: text('id').primaryKey(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id),
    rawText: text('raw_text').notNull(),
    constraintsJson: text('constraints_json').notNull(),
    status: text('status', { enum: ['received', 'archived'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_purchase_intents_created_at').on(table.createdAt)],
);

export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    provider: text('provider', { enum: ['mistral'] }).notNull(),
    model: text('model').notNull(),
    operation: text('operation', { enum: ['interpret_rfq'] }).notNull(),
    status: text('status', { enum: ['succeeded', 'failed'] }).notNull(),
    inputJson: text('input_json').notNull(),
    outputJson: text('output_json'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull(),
    failureCode: text('failure_code'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_agent_runs_status_created').on(table.status, table.createdAt),
  ],
);

export const purchaseRequirements = sqliteTable('purchase_requirements', {
  intentId: text('intent_id')
    .primaryKey()
    .references(() => purchaseIntents.id),
  quantity: integer('quantity').notNull(),
  maxUnitPaise: integer('max_unit_paise').notNull(),
  deliveryLocationsJson: text('delivery_locations_json').notNull(),
  deadline: text('deadline').notNull(),
});

export const intentAgentRuns = sqliteTable(
  'intent_agent_runs',
  {
    intentId: text('intent_id')
      .primaryKey()
      .references(() => purchaseIntents.id),
    agentRunId: text('agent_run_id')
      .notNull()
      .references(() => agentRuns.id),
    reviewStatus: text('review_status', { enum: ['confirmed', 'modified'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_intent_agent_runs_agent').on(table.agentRunId)],
);

export const deals = sqliteTable(
  'deals',
  {
    id: text('id').primaryKey(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id),
    intentId: text('intent_id')
      .notNull()
      .references(() => purchaseIntents.id),
    publicToken: text('public_token').notNull(),
    state: text('state', { enum: ['intent_received'] }).notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_deals_public_token').on(table.publicToken),
    index('idx_deals_merchant_state_created').on(
      table.merchantId,
      table.state,
      table.createdAt,
    ),
  ],
);

export const quotes = sqliteTable(
  'quotes',
  {
    id: text('id').primaryKey(),
    dealId: text('deal_id')
      .notNull()
      .references(() => deals.id),
    version: integer('version').notNull(),
    optionKey: text('option_key', {
      enum: ['best-value', 'balanced', 'premium-under-cap'],
    }).notNull(),
    label: text('label').notNull(),
    rationale: text('rationale').notNull(),
    linesJson: text('lines_json').notNull(),
    checksJson: text('checks_json').notNull(),
    quantity: integer('quantity').notNull(),
    unitTotalPaise: integer('unit_total_paise').notNull(),
    orderTotalPaise: integer('order_total_paise').notNull(),
    unitCostPaise: integer('unit_cost_paise').notNull(),
    contributionMarginBps: integer('contribution_margin_bps').notNull(),
    policyVersion: integer('policy_version').notNull().default(1),
    intentHash: text('intent_hash').notNull(),
    quoteHash: text('quote_hash').notNull(),
    status: text('status', {
      enum: ['merchant_approved', 'buyer_accepted', 'superseded', 'expired'],
    }).notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    approvedAt: text('approved_at').notNull(),
    acceptedAt: text('accepted_at'),
  },
  (table) => [
    uniqueIndex('idx_quotes_deal_version').on(table.dealId, table.version),
    uniqueIndex('idx_quotes_hash').on(table.quoteHash),
    index('idx_quotes_deal_status').on(table.dealId, table.status),
  ],
);

export const counteroffers = sqliteTable(
  'counteroffers',
  {
    id: text('id').primaryKey(),
    dealId: text('deal_id')
      .notNull()
      .references(() => deals.id),
    sourceQuoteId: text('source_quote_id')
      .notNull()
      .references(() => quotes.id),
    proposedQuoteId: text('proposed_quote_id').references(() => quotes.id),
    sourceKind: text('source_kind', {
      enum: ['structured', 'natural_language'],
    }).notNull(),
    buyerMessage: text('buyer_message').notNull(),
    targetUnitPaise: integer('target_unit_paise').notNull(),
    status: text('status', {
      enum: [
        'auto_approved',
        'bounded_counteroffer',
        'merchant_approval_required',
        'merchant_approved',
        'rejected',
      ],
    }).notNull(),
    proposedOptionJson: text('proposed_option_json'),
    checksJson: text('checks_json').notNull(),
    reasonCodesJson: text('reason_codes_json').notNull(),
    decisionSummary: text('decision_summary').notNull(),
    createdAt: text('created_at').notNull(),
    decidedAt: text('decided_at'),
  },
  (table) => [
    index('idx_counteroffers_deal_created').on(table.dealId, table.createdAt),
    index('idx_counteroffers_deal_status').on(table.dealId, table.status),
  ],
);

export const quoteEvents = sqliteTable(
  'quote_events',
  {
    id: text('id').primaryKey(),
    dealId: text('deal_id')
      .notNull()
      .references(() => deals.id),
    quoteId: text('quote_id').references(() => quotes.id),
    sequence: integer('sequence').notNull(),
    eventType: text('event_type').notNull(),
    actorType: text('actor_type', {
      enum: ['buyer', 'merchant', 'system'],
    }).notNull(),
    summary: text('summary').notNull(),
    dataJson: text('data_json').notNull(),
    previousHash: text('previous_hash').notNull().default(''),
    eventHash: text('event_hash').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_quote_events_deal_sequence').on(table.dealId, table.sequence),
    index('idx_quote_events_quote_type').on(table.quoteId, table.eventType),
    index('idx_quote_events_deal_created').on(table.dealId, table.createdAt),
    index('idx_quote_events_event_hash').on(table.eventHash),
  ],
);

export const paymentActions = sqliteTable(
  'payment_actions',
  {
    id: text('id').primaryKey(),
    dealId: text('deal_id')
      .notNull()
      .references(() => deals.id),
    quoteId: text('quote_id')
      .notNull()
      .references(() => quotes.id),
    idempotencyKey: text('idempotency_key').notNull(),
    actionType: text('action_type', { enum: ['create_order', 'refund'] }).notNull(),
    amountPaise: integer('amount_paise').notNull(),
    status: text('status', {
      enum: ['pending', 'succeeded', 'failed', 'reconciliation_required'],
    }).notNull(),
    provider: text('provider', { enum: ['razorpay', 'demo'] }).notNull(),
    providerReference: text('provider_reference'),
    failureCode: text('failure_code'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_payment_actions_idempotency').on(table.idempotencyKey),
    index('idx_payment_actions_deal_type').on(table.dealId, table.actionType),
    check('payment_actions_amount_positive', sql`${table.amountPaise} > 0`),
    check('payment_actions_type_valid', sql`${table.actionType} IN ('create_order', 'refund')`),
    check(
      'payment_actions_status_valid',
      sql`${table.status} IN ('pending', 'succeeded', 'failed', 'reconciliation_required')`,
    ),
    check('payment_actions_provider_valid', sql`${table.provider} IN ('razorpay', 'demo')`),
  ],
);

export const razorpayOrders = sqliteTable(
  'razorpay_orders',
  {
    id: text('id').primaryKey(),
    paymentActionId: text('payment_action_id')
      .notNull()
      .references(() => paymentActions.id),
    dealId: text('deal_id')
      .notNull()
      .references(() => deals.id),
    quoteId: text('quote_id')
      .notNull()
      .references(() => quotes.id),
    quoteHash: text('quote_hash').notNull(),
    mandateHash: text('mandate_hash').notNull(),
    policyVersion: integer('policy_version').notNull(),
    providerOrderId: text('provider_order_id').notNull(),
    provider: text('provider', { enum: ['razorpay', 'demo'] }).notNull(),
    checkoutKeyId: text('checkout_key_id'),
    amountPaise: integer('amount_paise').notNull(),
    currency: text('currency').notNull(),
    status: text('status', {
      enum: ['created', 'paid', 'refund_pending', 'refunded'],
    }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_razorpay_orders_action').on(table.paymentActionId),
    uniqueIndex('idx_razorpay_orders_provider_id').on(table.providerOrderId),
    uniqueIndex('idx_razorpay_orders_quote').on(table.quoteId),
    index('idx_razorpay_orders_deal_status').on(table.dealId, table.status),
    check('razorpay_orders_policy_version_positive', sql`${table.policyVersion} > 0`),
    check('razorpay_orders_amount_positive', sql`${table.amountPaise} > 0`),
    check('razorpay_orders_currency_inr', sql`${table.currency} = 'INR'`),
    check('razorpay_orders_provider_valid', sql`${table.provider} IN ('razorpay', 'demo')`),
    check(
      'razorpay_orders_status_valid',
      sql`${table.status} IN ('created', 'paid', 'refund_pending', 'refunded')`,
    ),
  ],
);

export const checkoutCallbacks = sqliteTable(
  'checkout_callbacks',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => razorpayOrders.id),
    providerPaymentId: text('provider_payment_id').notNull(),
    signatureVerified: integer('signature_verified', { mode: 'boolean' }).notNull(),
    payloadHash: text('payload_hash').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_checkout_callbacks_payment').on(table.providerPaymentId),
    index('idx_checkout_callbacks_order').on(table.orderId),
    check('checkout_callbacks_signature_boolean', sql`${table.signatureVerified} IN (0, 1)`),
  ],
);

export const razorpayPayments = sqliteTable(
  'razorpay_payments',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => razorpayOrders.id),
    providerPaymentId: text('provider_payment_id').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    currency: text('currency').notNull(),
    status: text('status', {
      enum: ['captured', 'partially_refunded', 'refunded'],
    }).notNull(),
    capturedAt: text('captured_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_razorpay_payments_provider_id').on(table.providerPaymentId),
    index('idx_razorpay_payments_order').on(table.orderId),
    check('razorpay_payments_amount_positive', sql`${table.amountPaise} > 0`),
    check('razorpay_payments_currency_inr', sql`${table.currency} = 'INR'`),
    check(
      'razorpay_payments_status_valid',
      sql`${table.status} IN ('captured', 'partially_refunded', 'refunded')`,
    ),
  ],
);

export const webhookInbox = sqliteTable(
  'webhook_inbox',
  {
    id: text('id').primaryKey(),
    eventType: text('event_type').notNull(),
    signatureVerified: integer('signature_verified', { mode: 'boolean' }).notNull(),
    payloadHash: text('payload_hash').notNull(),
    status: text('status', { enum: ['received', 'processed', 'rejected'] }).notNull(),
    failureCode: text('failure_code'),
    receivedAt: text('received_at').notNull(),
    processedAt: text('processed_at'),
  },
  (table) => [
    index('idx_webhook_inbox_status_received').on(table.status, table.receivedAt),
    check('webhook_inbox_signature_boolean', sql`${table.signatureVerified} IN (0, 1)`),
    check('webhook_inbox_status_valid', sql`${table.status} IN ('received', 'processed', 'rejected')`),
  ],
);

export const refunds = sqliteTable(
  'refunds',
  {
    id: text('id').primaryKey(),
    paymentId: text('payment_id')
      .notNull()
      .references(() => razorpayPayments.id),
    paymentActionId: text('payment_action_id')
      .notNull()
      .references(() => paymentActions.id),
    amountPaise: integer('amount_paise').notNull(),
    reason: text('reason').notNull(),
    providerRefundId: text('provider_refund_id'),
    status: text('status', {
      enum: ['pending', 'processed', 'failed', 'reconciliation_required'],
    }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_refunds_action').on(table.paymentActionId),
    uniqueIndex('idx_refunds_provider_id').on(table.providerRefundId),
    index('idx_refunds_payment_status').on(table.paymentId, table.status),
    check('refunds_amount_positive', sql`${table.amountPaise} > 0`),
    check(
      'refunds_status_valid',
      sql`${table.status} IN ('pending', 'processed', 'failed', 'reconciliation_required')`,
    ),
  ],
);

export const inventoryReservations = sqliteTable(
  'inventory_reservations',
  {
    id: text('id').primaryKey(),
    quoteId: text('quote_id')
      .notNull()
      .references(() => quotes.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull(),
    status: text('status', {
      enum: ['reserved', 'consumed', 'released', 'lost'],
    }).notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_inventory_reservations_quote_product').on(
      table.quoteId,
      table.productId,
    ),
    index('idx_inventory_reservations_status_expiry').on(table.status, table.expiresAt),
    check('inventory_reservations_quantity_positive', sql`${table.quantity} > 0`),
    check(
      'inventory_reservations_status_valid',
      sql`${table.status} IN ('reserved', 'consumed', 'released', 'lost')`,
    ),
  ],
);

export const fulfilmentIncidents = sqliteTable(
  'fulfilment_incidents',
  {
    id: text('id').primaryKey(),
    dealId: text('deal_id')
      .notNull()
      .references(() => deals.id),
    quoteId: text('quote_id')
      .notNull()
      .references(() => quotes.id),
    failedProductId: text('failed_product_id')
      .notNull()
      .references(() => products.id),
    blockedSubstituteProductId: text('blocked_substitute_product_id')
      .notNull()
      .references(() => products.id),
    status: text('status', {
      enum: ['replacement_offered', 'buyer_declined', 'refund_pending', 'refunded'],
    }).notNull(),
    failureCode: text('failure_code').notNull(),
    explanation: text('explanation').notNull(),
    replacementJson: text('replacement_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_fulfilment_incidents_deal').on(table.dealId),
    index('idx_fulfilment_incidents_status').on(table.status),
    check(
      'fulfilment_incidents_status_valid',
      sql`${table.status} IN ('replacement_offered', 'buyer_declined', 'refund_pending', 'refunded')`,
    ),
  ],
);

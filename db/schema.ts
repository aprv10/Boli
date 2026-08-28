import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const merchants = sqliteTable('merchants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status', { enum: ['active', 'inactive'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

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
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_quote_events_deal_sequence').on(table.dealId, table.sequence),
    uniqueIndex('idx_quote_events_quote_type').on(table.quoteId, table.eventType),
    index('idx_quote_events_deal_created').on(table.dealId, table.createdAt),
  ],
);

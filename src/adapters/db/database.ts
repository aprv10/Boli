import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@/db/schema';
import { DEMO_MERCHANT, SEED_PRODUCTS } from './seed-data';

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS negotiation_rounds (
    deal_id TEXT PRIMARY KEY NOT NULL,
    source_quote_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS merchant_changes (
    id TEXT PRIMARY KEY NOT NULL, merchant_id TEXT NOT NULL, kind TEXT NOT NULL,
    before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY NOT NULL,
    merchant_id TEXT NOT NULL REFERENCES merchants(id),
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
    unit_cost_paise INTEGER NOT NULL CHECK (unit_cost_paise >= 0),
    available_quantity INTEGER NOT NULL CHECK (available_quantity >= 0),
    reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    inventory_version INTEGER NOT NULL DEFAULT 1 CHECK (inventory_version > 0),
    lead_time_days INTEGER NOT NULL CHECK (lead_time_days >= 0),
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_products_merchant_sku ON products(merchant_id, sku)`,
  `CREATE INDEX IF NOT EXISTS idx_products_merchant_active ON products(merchant_id, active)`,
  `CREATE TABLE IF NOT EXISTS merchant_policy_versions (
    id TEXT PRIMARY KEY NOT NULL,
    merchant_id TEXT NOT NULL REFERENCES merchants(id),
    version INTEGER NOT NULL CHECK (version > 0),
    minimum_margin_bps INTEGER NOT NULL CHECK (minimum_margin_bps BETWEEN 0 AND 10000),
    maximum_automatic_concession_bps INTEGER NOT NULL CHECK (maximum_automatic_concession_bps BETWEEN 0 AND 10000),
    status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_policy_version ON merchant_policy_versions(merchant_id, version)`,
  `CREATE INDEX IF NOT EXISTS idx_merchant_policy_active ON merchant_policy_versions(merchant_id, status)`,
  `CREATE TABLE IF NOT EXISTS purchase_intents (
    id TEXT PRIMARY KEY NOT NULL,
    merchant_id TEXT NOT NULL REFERENCES merchants(id),
    raw_text TEXT NOT NULL,
    constraints_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('received', 'archived')),
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_purchase_intents_created_at ON purchase_intents(created_at)`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('mistral')),
    model TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('interpret_rfq')),
    status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
    input_json TEXT NOT NULL,
    output_json TEXT,
    prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
    completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
    total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
    failure_code TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_status_created ON agent_runs(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS purchase_requirements (
    intent_id TEXT PRIMARY KEY NOT NULL REFERENCES purchase_intents(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    max_unit_paise INTEGER NOT NULL CHECK (max_unit_paise > 0),
    delivery_locations_json TEXT NOT NULL,
    deadline TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS intent_agent_runs (
    intent_id TEXT PRIMARY KEY NOT NULL REFERENCES purchase_intents(id),
    agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
    review_status TEXT NOT NULL CHECK (review_status IN ('confirmed', 'modified')),
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_intent_agent_runs_agent ON intent_agent_runs(agent_run_id)`,
  `CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY NOT NULL,
    merchant_id TEXT NOT NULL REFERENCES merchants(id),
    intent_id TEXT NOT NULL REFERENCES purchase_intents(id),
    public_token TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('intent_received')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_public_token ON deals(public_token)`,
  `CREATE INDEX IF NOT EXISTS idx_deals_merchant_state_created ON deals(merchant_id, state, created_at)`,
  `CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY NOT NULL,
    deal_id TEXT NOT NULL REFERENCES deals(id),
    version INTEGER NOT NULL CHECK (version > 0),
    option_key TEXT NOT NULL CHECK (option_key IN ('best-value', 'balanced', 'premium-under-cap')),
    label TEXT NOT NULL,
    rationale TEXT NOT NULL,
    lines_json TEXT NOT NULL,
    checks_json TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_total_paise INTEGER NOT NULL CHECK (unit_total_paise > 0),
    order_total_paise INTEGER NOT NULL CHECK (order_total_paise > 0),
    unit_cost_paise INTEGER NOT NULL CHECK (unit_cost_paise >= 0),
    contribution_margin_bps INTEGER NOT NULL CHECK (contribution_margin_bps BETWEEN 0 AND 10000),
    policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version > 0),
    intent_hash TEXT NOT NULL,
    quote_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('merchant_approved', 'buyer_accepted', 'superseded', 'expired')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    accepted_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_deal_version ON quotes(deal_id, version)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_hash ON quotes(quote_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_quotes_deal_status ON quotes(deal_id, status)`,
  `CREATE TABLE IF NOT EXISTS counteroffers (
    id TEXT PRIMARY KEY NOT NULL,
    deal_id TEXT NOT NULL REFERENCES deals(id),
    source_quote_id TEXT NOT NULL REFERENCES quotes(id),
    proposed_quote_id TEXT REFERENCES quotes(id),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('structured', 'natural_language')),
    buyer_message TEXT NOT NULL,
    target_unit_paise INTEGER NOT NULL CHECK (target_unit_paise > 0),
    status TEXT NOT NULL CHECK (status IN ('auto_approved', 'bounded_counteroffer', 'merchant_approval_required', 'merchant_approved', 'rejected')),
    proposed_option_json TEXT,
    checks_json TEXT NOT NULL,
    reason_codes_json TEXT NOT NULL,
    decision_summary TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_counteroffers_deal_created ON counteroffers(deal_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_counteroffers_deal_status ON counteroffers(deal_id, status)`,
  `CREATE TABLE IF NOT EXISTS quote_events (
    id TEXT PRIMARY KEY NOT NULL,
    deal_id TEXT NOT NULL REFERENCES deals(id),
    quote_id TEXT REFERENCES quotes(id),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    event_type TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('buyer', 'merchant', 'system')),
    summary TEXT NOT NULL,
    data_json TEXT NOT NULL,
    previous_hash TEXT NOT NULL DEFAULT '',
    event_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_events_deal_sequence ON quote_events(deal_id, sequence)`,
  `CREATE INDEX IF NOT EXISTS idx_quote_events_quote_type ON quote_events(quote_id, event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_quote_events_deal_created ON quote_events(deal_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS payment_actions (
    id TEXT PRIMARY KEY NOT NULL,
    deal_id TEXT NOT NULL REFERENCES deals(id),
    quote_id TEXT NOT NULL REFERENCES quotes(id),
    idempotency_key TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN ('create_order', 'refund')),
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'reconciliation_required')),
    provider TEXT NOT NULL CHECK (provider IN ('razorpay', 'demo')),
    provider_reference TEXT,
    failure_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_actions_idempotency ON payment_actions(idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_actions_deal_type ON payment_actions(deal_id, action_type)`,
  `CREATE TABLE IF NOT EXISTS razorpay_orders (
    id TEXT PRIMARY KEY NOT NULL,
    payment_action_id TEXT NOT NULL REFERENCES payment_actions(id),
    deal_id TEXT NOT NULL REFERENCES deals(id),
    quote_id TEXT NOT NULL REFERENCES quotes(id),
    quote_hash TEXT NOT NULL,
    mandate_hash TEXT NOT NULL,
    policy_version INTEGER NOT NULL CHECK (policy_version > 0),
    provider_order_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('razorpay', 'demo')),
    checkout_key_id TEXT,
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    currency TEXT NOT NULL CHECK (currency = 'INR'),
    status TEXT NOT NULL CHECK (status IN ('created', 'paid', 'refund_pending', 'refunded')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_razorpay_orders_action ON razorpay_orders(payment_action_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_razorpay_orders_provider_id ON razorpay_orders(provider_order_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_razorpay_orders_quote ON razorpay_orders(quote_id)`,
  `CREATE INDEX IF NOT EXISTS idx_razorpay_orders_deal_status ON razorpay_orders(deal_id, status)`,
  `CREATE TABLE IF NOT EXISTS checkout_callbacks (
    id TEXT PRIMARY KEY NOT NULL,
    order_id TEXT NOT NULL REFERENCES razorpay_orders(id),
    provider_payment_id TEXT NOT NULL,
    signature_verified INTEGER NOT NULL CHECK (signature_verified IN (0, 1)),
    payload_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_callbacks_payment ON checkout_callbacks(provider_payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_checkout_callbacks_order ON checkout_callbacks(order_id)`,
  `CREATE TABLE IF NOT EXISTS razorpay_payments (
    id TEXT PRIMARY KEY NOT NULL,
    order_id TEXT NOT NULL REFERENCES razorpay_orders(id),
    provider_payment_id TEXT NOT NULL,
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    currency TEXT NOT NULL CHECK (currency = 'INR'),
    status TEXT NOT NULL CHECK (status IN ('captured', 'partially_refunded', 'refunded')),
    captured_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_razorpay_payments_provider_id ON razorpay_payments(provider_payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_razorpay_payments_order ON razorpay_payments(order_id)`,
  `CREATE TABLE IF NOT EXISTS webhook_inbox (
    id TEXT PRIMARY KEY NOT NULL,
    event_type TEXT NOT NULL,
    signature_verified INTEGER NOT NULL CHECK (signature_verified IN (0, 1)),
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('received', 'processed', 'rejected')),
    failure_code TEXT,
    received_at TEXT NOT NULL,
    processed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_inbox_status_received ON webhook_inbox(status, received_at)`,
  `CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY NOT NULL,
    payment_id TEXT NOT NULL REFERENCES razorpay_payments(id),
    payment_action_id TEXT NOT NULL REFERENCES payment_actions(id),
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    reason TEXT NOT NULL,
    provider_refund_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processed', 'failed', 'reconciliation_required')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_action ON refunds(payment_action_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_provider_id ON refunds(provider_refund_id)`,
  `CREATE INDEX IF NOT EXISTS idx_refunds_payment_status ON refunds(payment_id, status)`,
  `CREATE TABLE IF NOT EXISTS inventory_reservations (
    id TEXT PRIMARY KEY NOT NULL,
    quote_id TEXT NOT NULL REFERENCES quotes(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    status TEXT NOT NULL CHECK (status IN ('reserved', 'consumed', 'released', 'lost')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_reservations_quote_product ON inventory_reservations(quote_id, product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_reservations_status_expiry ON inventory_reservations(status, expires_at)`,
  `CREATE TABLE IF NOT EXISTS fulfilment_incidents (
    id TEXT PRIMARY KEY NOT NULL,
    deal_id TEXT NOT NULL REFERENCES deals(id),
    quote_id TEXT NOT NULL REFERENCES quotes(id),
    failed_product_id TEXT NOT NULL REFERENCES products(id),
    blocked_substitute_product_id TEXT NOT NULL REFERENCES products(id),
    status TEXT NOT NULL CHECK (status IN ('replacement_offered', 'buyer_declined', 'refund_pending', 'refunded')),
    failure_code TEXT NOT NULL,
    explanation TEXT NOT NULL,
    replacement_json TEXT NOT NULL,
    accepted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_fulfilment_incidents_deal ON fulfilment_incidents(deal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fulfilment_incidents_status ON fulfilment_incidents(status)`,
];

let initialization: Promise<void> | undefined;

export function getDatabase(binding: D1Database) {
  return drizzle(binding, { schema });
}

export async function ensureDatabase(binding: D1Database) {
  initialization ??= initialize(binding).catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

async function initialize(binding: D1Database) {
  await binding.batch(CREATE_STATEMENTS.map((statement) => binding.prepare(statement)));
  await ensureColumn(binding, 'purchase_requirements', 'selection_json',
    'ALTER TABLE purchase_requirements ADD COLUMN selection_json TEXT');

  await ensureColumn(binding, 'quotes', 'policy_version',
    'ALTER TABLE quotes ADD COLUMN policy_version INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(binding, 'quote_events', 'previous_hash',
    "ALTER TABLE quote_events ADD COLUMN previous_hash TEXT NOT NULL DEFAULT ''");
  await ensureColumn(binding, 'quote_events', 'event_hash',
    "ALTER TABLE quote_events ADD COLUMN event_hash TEXT NOT NULL DEFAULT ''");
  await ensureColumn(binding, 'products', 'reserved_quantity',
    'ALTER TABLE products ADD COLUMN reserved_quantity INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(binding, 'products', 'inventory_version',
    'ALTER TABLE products ADD COLUMN inventory_version INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(binding, 'fulfilment_incidents', 'accepted_at',
    'ALTER TABLE fulfilment_incidents ADD COLUMN accepted_at TEXT');
  await binding
    .prepare('CREATE INDEX IF NOT EXISTS idx_quote_events_event_hash ON quote_events(event_hash)')
    .run();
  const eventTypeIndex = await binding
    .prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = 'idx_quote_events_quote_type'")
    .first<{ sql: string }>();
  if (eventTypeIndex?.sql?.toUpperCase().includes('CREATE UNIQUE INDEX')) {
    await binding.batch([
      binding.prepare('DROP INDEX idx_quote_events_quote_type'),
      binding.prepare('CREATE INDEX idx_quote_events_quote_type ON quote_events(quote_id, event_type)'),
    ]);
  }

  const createdAt = '2026-08-25T00:00:00.000Z';
  const seedStatements = [
    binding
      .prepare(
        `INSERT OR IGNORE INTO merchants (id, name, slug, status, created_at)
         VALUES (?, ?, ?, 'active', ?)`,
      )
      .bind(DEMO_MERCHANT.id, DEMO_MERCHANT.name, DEMO_MERCHANT.slug, createdAt),
    binding
      .prepare(
        `INSERT OR IGNORE INTO merchant_policy_versions (
          id, merchant_id, version, minimum_margin_bps,
          maximum_automatic_concession_bps, status, created_at
        ) VALUES ('policy-good-batch-v1', ?, 1, 2200, 1200, 'active', ?)`,
      )
      .bind(DEMO_MERCHANT.id, createdAt),
    ...SEED_PRODUCTS.map((product) =>
      binding
        .prepare(
          `INSERT OR IGNORE INTO products (
            id, merchant_id, sku, name, category, tags_json, unit_price_paise,
            unit_cost_paise, available_quantity, lead_time_days, active, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .bind(
          product.id,
          DEMO_MERCHANT.id,
          product.sku,
          product.name,
          product.category,
          JSON.stringify(product.tags),
          product.unitPricePaise,
          product.unitCostPaise,
          product.availableQuantity,
          product.leadTimeDays,
          createdAt,
        ),
    ),
  ];

  await binding.batch(seedStatements);
  await binding.prepare('PRAGMA optimize').run();
}

async function ensureColumn(
  binding: D1Database,
  table: string,
  column: string,
  statement: string,
) {
  const result = await binding.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (!result.results.some((item) => item.name === column)) {
    await binding.prepare(statement).run();
  }
}

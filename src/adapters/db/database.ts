import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@/db/schema';
import { DEMO_MERCHANT, SEED_PRODUCTS } from './seed-data';

const CREATE_STATEMENTS = [
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
    lead_time_days INTEGER NOT NULL CHECK (lead_time_days >= 0),
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_products_merchant_sku ON products(merchant_id, sku)`,
  `CREATE INDEX IF NOT EXISTS idx_products_merchant_active ON products(merchant_id, active)`,
  `CREATE TABLE IF NOT EXISTS purchase_intents (
    id TEXT PRIMARY KEY NOT NULL,
    merchant_id TEXT NOT NULL REFERENCES merchants(id),
    raw_text TEXT NOT NULL,
    constraints_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('received', 'archived')),
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_purchase_intents_created_at ON purchase_intents(created_at)`,
  `CREATE TABLE IF NOT EXISTS purchase_requirements (
    intent_id TEXT PRIMARY KEY NOT NULL REFERENCES purchase_intents(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    max_unit_paise INTEGER NOT NULL CHECK (max_unit_paise > 0),
    delivery_locations_json TEXT NOT NULL,
    deadline TEXT NOT NULL
  )`,
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
  `CREATE TABLE IF NOT EXISTS quote_events (
    id TEXT PRIMARY KEY NOT NULL,
    deal_id TEXT NOT NULL REFERENCES deals(id),
    quote_id TEXT REFERENCES quotes(id),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    event_type TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('buyer', 'merchant', 'system')),
    summary TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_events_deal_sequence ON quote_events(deal_id, sequence)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_events_quote_type ON quote_events(quote_id, event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_quote_events_deal_created ON quote_events(deal_id, created_at)`,
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

  const createdAt = '2026-08-25T00:00:00.000Z';
  const seedStatements = [
    binding
      .prepare(
        `INSERT OR IGNORE INTO merchants (id, name, slug, status, created_at)
         VALUES (?, ?, ?, 'active', ?)`,
      )
      .bind(DEMO_MERCHANT.id, DEMO_MERCHANT.name, DEMO_MERCHANT.slug, createdAt),
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

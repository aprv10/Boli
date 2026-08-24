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

export const purchaseRequirements = sqliteTable('purchase_requirements', {
  intentId: text('intent_id')
    .primaryKey()
    .references(() => purchaseIntents.id),
  quantity: integer('quantity').notNull(),
  maxUnitPaise: integer('max_unit_paise').notNull(),
  deliveryLocationsJson: text('delivery_locations_json').notNull(),
  deadline: text('deadline').notNull(),
});

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

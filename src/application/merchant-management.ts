import { DEMO_MERCHANT } from '@/src/adapters/db/seed-data';
import { loadActiveMerchantPolicy } from './policy-gate';

export function assertLocalMerchantWrite(request: Request) {
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || request.headers.get('origin') !== url.origin) {
    throw new Error('Merchant editing is available only from the same-origin local demo workspace.');
  }
}

export async function saveMerchantRules(db: D1Database, input: { expectedVersion: number; minimumMarginBps: number; maximumAutomaticConcessionBps: number }) {
  const current = await loadActiveMerchantPolicy(db, DEMO_MERCHANT.id);
  if (current.version !== input.expectedVersion) throw new Error('Rules changed in another window. Refresh before saving.');
  const now = new Date().toISOString();
  const next = { ...input, version: current.version + 1 };
  await db.batch([
    db.prepare(`INSERT INTO merchant_changes (id, merchant_id, kind, before_json, after_json, created_at)
      VALUES (?, ?, 'rules', (SELECT json_object('version', version, 'minimumMarginBps', minimum_margin_bps, 'maximumAutomaticConcessionBps', maximum_automatic_concession_bps)
      FROM merchant_policy_versions WHERE merchant_id = ? AND version = ? AND status = 'active'), ?, ?)`)
      .bind(crypto.randomUUID(), DEMO_MERCHANT.id, DEMO_MERCHANT.id, current.version, JSON.stringify(next), now),
    db.prepare("UPDATE merchant_policy_versions SET status = 'retired' WHERE merchant_id = ? AND status = 'active' AND version = ?").bind(DEMO_MERCHANT.id, current.version),
    db.prepare(`INSERT INTO merchant_policy_versions (id, merchant_id, version, minimum_margin_bps, maximum_automatic_concession_bps, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)`)
      .bind(crypto.randomUUID(), DEMO_MERCHANT.id, next.version, input.minimumMarginBps, input.maximumAutomaticConcessionBps, now),
  ]);
  return next;
}

export async function saveMerchantProduct(db: D1Database, id: string, input: { expectedVersion: number; pricePaise: number; costPaise: number; stock: number; days: number }) {
  const product = await db.prepare('SELECT * FROM products WHERE id = ? AND merchant_id = ?').bind(id, DEMO_MERCHANT.id).first<{ inventory_version: number; reserved_quantity: number }>();
  if (!product || product.inventory_version !== input.expectedVersion) throw new Error('This product changed. Refresh before saving.');
  if (input.stock < product.reserved_quantity) throw new Error('Stock cannot be lower than the quantity already reserved for orders.');
  await db.batch([
    db.prepare(`INSERT INTO merchant_changes (id, merchant_id, kind, before_json, after_json, created_at) VALUES (?, ?, 'product',
      (SELECT json_object('id', id, 'pricePaise', unit_price_paise, 'costPaise', unit_cost_paise, 'stock', available_quantity, 'days', lead_time_days)
      FROM products WHERE id = ? AND merchant_id = ? AND inventory_version = ? AND reserved_quantity <= ?), ?, ?)`)
      .bind(crypto.randomUUID(), DEMO_MERCHANT.id, id, DEMO_MERCHANT.id, input.expectedVersion, input.stock, JSON.stringify({ id, ...input }), new Date().toISOString()),
    db.prepare(`UPDATE products SET unit_price_paise = ?, unit_cost_paise = ?, available_quantity = ?, lead_time_days = ?, inventory_version = inventory_version + 1
      WHERE id = ? AND merchant_id = ? AND inventory_version = ?`)
      .bind(input.pricePaise, input.costPaise, input.stock, input.days, id, DEMO_MERCHANT.id, input.expectedVersion),
  ]);
}

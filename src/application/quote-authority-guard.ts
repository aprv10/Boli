import type { CatalogProduct, QuoteOption } from '@/src/domain/quoting/types';

/** Fail the entire D1 batch if a policy or product changed since evaluation.
 * This does not reserve stock; checkout still owns the inventory reservation.
 */
export function quoteAuthorityGuard(db: D1Database, input: {
  merchantId: string; policyVersion: number; quantity: number; catalog: CatalogProduct[]; option: QuoteOption; now: string;
}) {
  const wanted = input.option.lines.filter(line => line.kind === 'product').map(line => {
    const product = input.catalog.find(item => item.id === line.productId);
    return { id: line.productId ?? '', price: product?.unitPricePaise ?? -1, cost: product?.unitCostPaise ?? -1,
      days: product?.leadTimeDays ?? -1, tags: JSON.stringify(product?.tags ?? []) };
  });
  return db.prepare(`INSERT INTO merchant_changes (id,merchant_id,kind,before_json,after_json,created_at)
    VALUES (?,?,'quote_authority',(SELECT json_object('policyVersion',m.version) FROM merchant_policy_versions m
      WHERE m.merchant_id=? AND m.version=? AND m.status='active' AND NOT EXISTS (
        SELECT 1 FROM json_each(?) wanted LEFT JOIN products p ON p.id=json_extract(wanted.value,'$.id')
        WHERE p.id IS NULL OR p.merchant_id<>m.merchant_id OR p.active<>1
          OR p.unit_price_paise<>json_extract(wanted.value,'$.price')
          OR p.unit_cost_paise<>json_extract(wanted.value,'$.cost')
          OR p.lead_time_days<>json_extract(wanted.value,'$.days')
          OR json(p.tags_json)<>json_extract(wanted.value,'$.tags')
          OR p.available_quantity-p.reserved_quantity<?
      )),?,?)`).bind(crypto.randomUUID(), input.merchantId, input.merchantId, input.policyVersion,
        JSON.stringify(wanted), input.quantity, JSON.stringify({ products: wanted.map(item => item.id) }), input.now);
}

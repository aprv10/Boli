import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { DEMO_MERCHANT } from '@/src/adapters/db/seed-data';
import { ProductEditor, type EditableProduct } from './product-editor';
export default async function ProductsPage() {
  await ensureDatabase(env.DB);
  const rows = await env.DB.prepare('SELECT id, sku, name, unit_price_paise AS price, unit_cost_paise AS cost, available_quantity AS stock, reserved_quantity AS reserved, lead_time_days AS days, inventory_version AS version FROM products WHERE merchant_id = ? AND active = 1 ORDER BY name').bind(DEMO_MERCHANT.id).all<EditableProduct>();
  return <main className="new-shell merchant-workspace"><header className="merchant-heading"><div><p className="eyebrow">The Good Batch</p><h1>Products</h1><p>{rows.results.length} active products. Update prices and stock without changing accepted orders.</p></div></header><section className="merchant-content"><ProductEditor products={rows.results} /></section></main>;
}

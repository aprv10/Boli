import Link from 'next/link';
import { env } from 'cloudflare:workers';
import { Package } from 'lucide-react';
import { ensureDatabase } from '@/src/adapters/db/database';
import { DEMO_MERCHANT } from '@/src/adapters/db/seed-data';

export default async function CatalogPage() {
  await ensureDatabase(env.DB);
  const rows = await env.DB.prepare('SELECT name, category, tags_json AS tags, unit_price_paise AS price, MAX(0, available_quantity - reserved_quantity) AS stock, lead_time_days AS days FROM products WHERE merchant_id = ? AND active = 1 ORDER BY category, name').bind(DEMO_MERCHANT.id).all<{name: string; category: string; tags: string; price: number; stock: number; days: number}>();
  return <main className="new-shell"><section className="shopping-workspace">
    <header className="shopping-section-heading"><div><span>THE GOOD BATCH · DEMO CATALOG</span><h1>Meet the products.</h1><p>Current prices and available stock. Delivery and services are calculated when you request an order.</p></div><Link className="action-link" href="/request">Start a request →</Link></header>
    <div className="catalog-grid">{rows.results.map(product => <article key={product.name}><div className="catalog-illustration" aria-hidden="true"><Package size={40} /></div><span>{product.category}</span><h2>{product.name}</h2><strong>₹{(product.price / 100).toLocaleString('en-IN')}</strong><p>{product.stock} available · {product.days} day lead time</p><div className="constraint-ticks">{(JSON.parse(product.tags) as string[]).map(tag => <span key={tag}>{tag}</span>)}</div>{product.stock > 0 ? <Link className="catalog-request-link" href={`/request?product=${encodeURIComponent(product.name)}`}>Choose product →</Link> : <span className="catalog-stock-note">Currently unavailable</span>}</article>)}</div>
  </section></main>;
}

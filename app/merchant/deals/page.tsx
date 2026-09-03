import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { loadMerchantOrders } from '@/src/application/merchant-overview';
import { OrderTable } from '../order-table';

export default async function MerchantDealsPage() {
  await ensureDatabase(env.DB);
  const orders = await loadMerchantOrders(env.DB);
  return <main className="new-shell merchant-workspace"><header className="merchant-heading"><div><p className="eyebrow">The Good Batch</p><h1>Orders</h1><p>{orders.length} buyer requests · {orders.filter(order => order.pending).length} awaiting your approval</p></div></header><section className="merchant-content"><OrderTable orders={orders} /></section></main>;
}

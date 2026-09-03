import Link from 'next/link';
import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { loadMerchantOrders, merchantOrderStatus } from '@/src/application/merchant-overview';
const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
export default async function TransactionsPage() {
  await ensureDatabase(env.DB);
  const orders = await loadMerchantOrders(env.DB);
  return <main className="new-shell merchant-workspace"><header className="merchant-heading"><div><h1>Transactions</h1><p>Return to an order, complete payment, or follow a replacement or refund.</p></div><Link className="subtle-button" href="/request">New request →</Link></header>
    <section className="merchant-content">{orders.length ? <div className="merchant-table-wrap"><table className="merchant-table"><thead><tr><th>Order</th><th>Your request</th><th>Total</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td><strong>#{order.id.slice(0, 8).toUpperCase()}</strong><small>{new Date(order.createdAt).toLocaleDateString('en-IN')}</small></td><td><span className="table-request">{order.request}</span></td><td>{order.amountPaise == null ? 'Not quoted' : money(order.amountPaise)}</td><td><span className="status-pill">{merchantOrderStatus(order)}</span></td><td><Link className="table-action" href={`/deal/${order.publicToken}`}>View order →</Link></td></tr>)}</tbody></table></div> : <div className="shopping-empty"><h2>No transactions yet</h2><p>Start with something you need. Your orders will appear here.</p><Link href="/request">Find my options →</Link></div>}</section>
  </main>;
}

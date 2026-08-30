import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { SEED_PRODUCTS } from '@/src/adapters/db/seed-data';

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return new Response(null, { status: 404 });
  }

  await ensureDatabase(env.DB);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM fulfilment_incidents'),
    env.DB.prepare('DELETE FROM refunds'),
    env.DB.prepare('DELETE FROM webhook_inbox'),
    env.DB.prepare('DELETE FROM checkout_callbacks'),
    env.DB.prepare('DELETE FROM razorpay_payments'),
    env.DB.prepare('DELETE FROM razorpay_orders'),
    env.DB.prepare('DELETE FROM payment_actions'),
    env.DB.prepare('DELETE FROM inventory_reservations'),
    env.DB.prepare('DELETE FROM quote_events'),
    env.DB.prepare('DELETE FROM counteroffers'),
    env.DB.prepare('DELETE FROM quotes'),
    env.DB.prepare('DELETE FROM deals'),
    env.DB.prepare('DELETE FROM intent_agent_runs'),
    env.DB.prepare('DELETE FROM purchase_requirements'),
    env.DB.prepare('DELETE FROM purchase_intents'),
    env.DB.prepare('DELETE FROM agent_runs'),
    ...SEED_PRODUCTS.map((product) =>
      env.DB
        .prepare(
          `UPDATE products SET available_quantity = ?, reserved_quantity = 0,
            inventory_version = inventory_version + 1 WHERE id = ?`,
        )
        .bind(product.availableQuantity, product.id),
    ),
  ]);

  return Response.json({ status: 'reset' });
}

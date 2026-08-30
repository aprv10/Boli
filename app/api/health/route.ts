import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { configuredPaymentProvider } from '@/src/adapters/payments/razorpay';

export async function GET() {
  await ensureDatabase(env.DB);
  await env.DB.prepare('SELECT 1').first();

  return Response.json({
    status: 'ready',
    database: 'connected',
    paymentProvider: configuredPaymentProvider(),
    paymentMode: 'test_only',
  });
}

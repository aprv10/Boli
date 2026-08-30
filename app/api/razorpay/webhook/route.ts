import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { PaymentProviderError, webhookSecret } from '@/src/adapters/payments/razorpay';
import {
  PaymentWorkflowError,
  processRazorpayWebhook,
} from '@/src/application/payment-workflow';

export async function POST(request: Request) {
  await ensureDatabase(env.DB);
  const signature = request.headers.get('x-razorpay-signature') ?? '';
  const eventId = request.headers.get('x-razorpay-event-id') ?? '';
  if (!signature || !eventId) {
    return Response.json(
      { error: { code: 'WEBHOOK_HEADERS_MISSING', message: 'Required webhook headers are missing.' } },
      { status: 400 },
    );
  }
  const rawBody = await request.text();
  try {
    return Response.json(
      await processRazorpayWebhook(env.DB, {
        rawBody,
        signature,
        eventId,
        secret: webhookSecret(),
      }),
    );
  } catch (error) {
    if (error instanceof PaymentWorkflowError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    if (error instanceof PaymentProviderError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: 503 },
      );
    }
    throw error;
  }
}

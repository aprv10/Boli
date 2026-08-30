import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { checkoutSecret, PaymentProviderError } from '@/src/adapters/payments/razorpay';
import { PaymentWorkflowError, verifyCheckoutCallback } from '@/src/application/payment-workflow';

const requestSchema = z.object({
  razorpay_order_id: z.string().min(4).max(120),
  razorpay_payment_id: z.string().min(4).max(120),
  razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(request: Request) {
  await ensureDatabase(env.DB);
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'INVALID_CHECKOUT_CALLBACK', message: 'Checkout callback is malformed.' } },
      { status: 400 },
    );
  }
  try {
    return Response.json(
      await verifyCheckoutCallback(
        env.DB,
        {
          providerOrderId: parsed.data.razorpay_order_id,
          providerPaymentId: parsed.data.razorpay_payment_id,
          signature: parsed.data.razorpay_signature,
        },
        checkoutSecret(),
      ),
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

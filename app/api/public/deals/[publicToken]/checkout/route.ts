import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { createCheckoutOrder, PaymentWorkflowError } from '@/src/application/payment-workflow';

const requestSchema = z.object({
  expectedQuoteHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicToken: string }> },
) {
  await ensureDatabase(env.DB);
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'INVALID_CHECKOUT_REQUEST', message: 'Checkout request is incomplete.' } },
      { status: 400 },
    );
  }
  try {
    const { publicToken } = await params;
    return Response.json(
      await createCheckoutOrder(
        env.DB,
        publicToken,
        parsed.data.expectedQuoteHash,
        parsed.data.idempotencyKey,
      ),
    );
  } catch (error) {
    if (error instanceof PaymentWorkflowError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }
}

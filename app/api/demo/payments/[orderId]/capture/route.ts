import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { PaymentWorkflowError, simulateDemoPayment } from '@/src/application/payment-workflow';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  await ensureDatabase(env.DB);
  try {
    const { orderId } = await params;
    return Response.json(await simulateDemoPayment(env.DB, orderId));
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

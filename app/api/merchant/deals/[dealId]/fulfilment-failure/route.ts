import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { reportDemoFulfilmentFailure } from '@/src/application/fulfilment-workflow';
import { PaymentWorkflowError } from '@/src/application/payment-workflow';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ dealId: string }> },
) {
  await ensureDatabase(env.DB);
  try {
    const { dealId } = await params;
    return Response.json(await reportDemoFulfilmentFailure(env.DB, dealId));
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

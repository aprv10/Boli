import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { acceptCompliantReplacement } from '@/src/application/fulfilment-workflow';
import { PaymentWorkflowError } from '@/src/application/payment-workflow';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ publicToken: string }> },
) {
  await ensureDatabase(env.DB);
  try {
    const { publicToken } = await params;
    return Response.json(await acceptCompliantReplacement(env.DB, publicToken));
  } catch (error) {
    if (error instanceof PaymentWorkflowError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

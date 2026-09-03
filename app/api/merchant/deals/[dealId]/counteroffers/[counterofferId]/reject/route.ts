import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { rejectPendingCounteroffer } from '@/src/application/counteroffer-workflow';
import { QuoteWorkflowError } from '@/src/application/quote-workflow';
import { assertLocalMerchantWrite } from '@/src/application/merchant-management';
export async function POST(request: Request, { params }: { params: Promise<{ dealId: string; counterofferId: string }> }) {
  try { assertLocalMerchantWrite(request); } catch { return Response.json({ error: { message: 'Use the local merchant workspace to decline offers.' } }, { status: 403 }); }
  await ensureDatabase(env.DB);
  try {
    const { dealId, counterofferId } = await params;
    return Response.json(await rejectPendingCounteroffer(env.DB, dealId, counterofferId));
  } catch (error) {
    return Response.json({ error: { message: error instanceof QuoteWorkflowError ? error.message : 'The order changed. Refresh before deciding.' } }, { status: error instanceof QuoteWorkflowError ? error.status : 409 });
  }
}

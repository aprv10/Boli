import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { approvePendingCounteroffer } from '@/src/application/counteroffer-workflow';
import { QuoteWorkflowError } from '@/src/application/quote-workflow';
import { assertLocalMerchantWrite } from '@/src/application/merchant-management';

type RouteContext = {
  params: Promise<{ dealId: string; counterofferId: string }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  try { assertLocalMerchantWrite(_request); } catch { return Response.json({ error: { message: 'Use the local merchant workspace to approve offers.' } }, { status: 403 }); }
  await ensureDatabase(env.DB);
  try {
    const { dealId, counterofferId } = await params;
    const result = await approvePendingCounteroffer(
      env.DB,
      dealId,
      counterofferId,
    );
    return Response.json({
      counteroffer: {
        id: result.counteroffer.id,
        status: result.counteroffer.status,
      },
      quote: {
        version: result.quote.version,
        quoteHash: result.quote.quoteHash,
        unitTotalPaise: result.quote.unitTotalPaise,
        status: result.quote.status,
      },
      reused: result.reused,
    });
  } catch (error) {
    if (error instanceof QuoteWorkflowError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }
}

import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import {
  acceptCurrentQuote,
  QuoteWorkflowError,
} from '@/src/application/quote-workflow';

type RouteContext = { params: Promise<{ publicToken: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  await ensureDatabase(env.DB);
  try {
    const { publicToken } = await params;
    const result = await acceptCurrentQuote(env.DB, publicToken);
    return Response.json({
      quote: {
        id: result.quote.id,
        version: result.quote.version,
        quoteHash: result.quote.quoteHash,
        status: result.quote.status,
        acceptedAt: result.quote.acceptedAt,
      },
      alreadyAccepted: result.alreadyAccepted,
      nextAction: 'CHECKOUT_REQUIRES_A_SEPARATE_EXPLICIT_GATE',
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

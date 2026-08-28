import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import {
  acceptCurrentQuote,
  QuoteWorkflowError,
} from '@/src/application/quote-workflow';

type RouteContext = { params: Promise<{ publicToken: string }> };

const inputSchema = z.object({
  expectedQuoteHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(request: Request, { params }: RouteContext) {
  await ensureDatabase(env.DB);
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'VALIDATION_FAILED', message: 'A valid quote fingerprint is required.' } },
      { status: 400 },
    );
  }
  try {
    const { publicToken } = await params;
    const result = await acceptCurrentQuote(
      env.DB,
      publicToken,
      parsed.data.expectedQuoteHash,
    );
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

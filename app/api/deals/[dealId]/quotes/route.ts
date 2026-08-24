import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import {
  approveQuoteOption,
  QuoteWorkflowError,
} from '@/src/application/quote-workflow';

const inputSchema = z.object({
  optionKey: z.enum(['best-value', 'balanced', 'premium-under-cap']),
});

type RouteContext = { params: Promise<{ dealId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  await ensureDatabase(env.DB);
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Choose a valid quote option.' } },
      { status: 400 },
    );
  }

  try {
    const { dealId } = await params;
    const result = await approveQuoteOption(env.DB, dealId, parsed.data.optionKey);
    return Response.json({
      quote: {
        id: result.quote.id,
        version: result.quote.version,
        quoteHash: result.quote.quoteHash,
        status: result.quote.status,
        expiresAt: result.quote.expiresAt,
      },
      dealRoomPath: `/deal/${result.publicToken}`,
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

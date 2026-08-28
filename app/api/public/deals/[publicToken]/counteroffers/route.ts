import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { submitBoundedCounteroffer } from '@/src/application/counteroffer-workflow';
import { QuoteWorkflowError } from '@/src/application/quote-workflow';

const inputSchema = z.object({
  expectedQuoteHash: z.string().regex(/^[a-f0-9]{64}$/),
  targetUnitPaise: z.number().int().min(10_000).max(10_000_000),
  buyerMessage: z.string().trim().min(8).max(280),
});

type RouteContext = { params: Promise<{ publicToken: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  await ensureDatabase(env.DB);
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Enter a valid lower target and a short reason for the proposal.',
        },
      },
      { status: 400 },
    );
  }

  try {
    const { publicToken } = await params;
    const result = await submitBoundedCounteroffer(
      env.DB,
      publicToken,
      parsed.data,
    );
    return Response.json({
      counteroffer: {
        id: result.counteroffer.id,
        status: result.counteroffer.status,
        targetUnitPaise: result.counteroffer.targetUnitPaise,
        proposedUnitPaise:
          result.counteroffer.proposedOption?.unitTotalPaise ?? null,
        summary: result.counteroffer.decisionSummary,
        checks: result.counteroffer.checks,
        reasonCodes: result.counteroffer.reasonCodes,
      },
      quote: result.quote
        ? {
            version: result.quote.version,
            quoteHash: result.quote.quoteHash,
            unitTotalPaise: result.quote.unitTotalPaise,
            status: result.quote.status,
          }
        : null,
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

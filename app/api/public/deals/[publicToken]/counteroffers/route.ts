import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { submitBoundedCounteroffer } from '@/src/application/counteroffer-workflow';
import { QuoteWorkflowError } from '@/src/application/quote-workflow';
import { interpretNegotiationRequest, UnclearNegotiationTarget } from '@/src/application/agent/mistral-negotiation';

const inputSchema = z.object({
  expectedQuoteHash: z.string().regex(/^[a-f0-9]{64}$/),
  targetUnitPaise: z.number().int().min(100).max(10_000_000).optional(),
  buyerMessage: z.string().trim().min(3).max(280),
  awaitBuyerChoice: z.boolean().optional(),
  allowAlternatives: z.boolean().optional(),
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
    const interpreted = parsed.data.targetUnitPaise
      ? { targetUnitPaise: parsed.data.targetUnitPaise, condition: null, interpreter: 'structured' as const }
      : await interpretNegotiationRequest({
          message: parsed.data.buyerMessage,
          apiKey: env.MISTRAL_API_KEY ?? process.env.MISTRAL_API_KEY,
        });
    const result = await submitBoundedCounteroffer(
      env.DB,
      publicToken,
      {
        expectedQuoteHash: parsed.data.expectedQuoteHash,
        targetUnitPaise: interpreted.targetUnitPaise,
        buyerMessage: parsed.data.buyerMessage,
        sourceKind: parsed.data.targetUnitPaise ? 'structured' : 'natural_language',
        awaitBuyerChoice: parsed.data.awaitBuyerChoice,
        allowAlternatives: parsed.data.allowAlternatives,
      },
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
      interpretation: {
        provider: interpreted.interpreter,
        targetUnitPaise: interpreted.targetUnitPaise,
        condition: interpreted.condition,
        authority: 'LANGUAGE_ONLY',
      },
    });
  } catch (error) {
    if (error instanceof QuoteWorkflowError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    if (error instanceof UnclearNegotiationTarget) return Response.json({ error: { code: 'TARGET_UNCLEAR', message: 'Ask for one final price per item, for example “₹250 per bottle”. Change products, quantity or requirements in a new buying request. This has not used your negotiation round.' } }, { status: 422 });
    return Response.json({ error: { code: 'NEGOTIATION_UNAVAILABLE', message: 'We could not confirm the result. Refresh this order before trying again.' } }, { status: 500 });
  }
}

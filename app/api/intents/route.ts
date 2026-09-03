import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { submitPurchaseIntent } from '@/src/application/intent-workflow';

const purchaseIntentInput = z.object({
  rawText: z.string().trim().min(3).max(600),
  selection: z.object({ mode: z.enum(['kit', 'product']), query: z.string().trim().max(120) }).refine(value => value.mode === 'kit' || value.query.length > 1).optional(),
  unsupportedRequirements: z.array(z.string()).max(0).optional(),
  hardConstraints: z
    .array(z.enum(['vegan', 'plastic-free', 'branded', 'multi-city']))
    .max(8),
  quantity: z.number().int().min(1).max(10_000),
  maxUnitPaise: z.number().int().min(100).max(10_000_000),
  deliveryLocations: z.array(z.string().trim().min(2).max(80)).min(1).max(10),
  deadline: z.iso.date().refine(value => value >= new Date().toISOString().slice(0, 10), 'Choose today or a future delivery date.'),
  agentRunId: z.uuid().optional(),
  agentReviewStatus: z.enum(['confirmed', 'modified']).optional(),
}).refine(
  (value) => Boolean(value.agentRunId) === Boolean(value.agentReviewStatus),
  { message: 'AI trace and review status must be provided together.' },
).refine(value => !value.hardConstraints.includes('multi-city') || new Set(value.deliveryLocations.map(city => city.toLowerCase())).size >= 2, { message: 'Add at least two different delivery cities or remove the multi-city requirement.' });

export async function POST(request: Request) {
  await ensureDatabase(env.DB);

  const parsed = purchaseIntentInput.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Add a little more detail before Boli shapes the request.',
          fields: z.flattenError(parsed.error).fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  let deal;
  try {
    deal = await submitPurchaseIntent(env.DB, parsed.data);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_AGENT_TRACE') {
      return Response.json(
        {
          error: {
            code: 'INVALID_AGENT_TRACE',
            message: 'The selected AI interpretation is unavailable. Re-run it or submit manually.',
          },
        },
        { status: 400 },
      );
    }
    throw error;
  }

  return Response.json(
    {
      deal: {
        id: deal.id,
        publicToken: deal.publicToken,
        state: deal.state,
        createdAt: deal.createdAt,
        interpretation: parsed.data.agentRunId
          ? {
              runId: parsed.data.agentRunId,
              reviewStatus: parsed.data.agentReviewStatus,
            }
          : null,
      },
    },
    { status: 201 },
  );
}

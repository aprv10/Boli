import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { submitPurchaseIntent } from '@/src/application/intent-workflow';

const purchaseIntentInput = z.object({
  rawText: z.string().trim().min(40).max(600),
  hardConstraints: z
    .array(z.enum(['vegan', 'plastic-free', 'branded', 'multi-city']))
    .max(8),
  quantity: z.number().int().min(10).max(10_000),
  maxUnitPaise: z.number().int().min(10_000).max(10_000_000),
  deliveryLocations: z.array(z.string().trim().min(2).max(80)).min(1).max(10),
  deadline: z.iso.date(),
  agentRunId: z.uuid().optional(),
  agentReviewStatus: z.enum(['confirmed', 'modified']).optional(),
}).refine(
  (value) => Boolean(value.agentRunId) === Boolean(value.agentReviewStatus),
  { message: 'AI trace and review status must be provided together.' },
);

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

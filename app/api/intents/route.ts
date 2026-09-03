import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { submitPurchaseIntent } from '@/src/application/intent-workflow';
import { requiresMerchantReview } from '@/src/domain/quoting/custom-requirements';
import { purchaseIntentInput } from '@/src/application/purchase-contract';

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
    deal = await submitPurchaseIntent(env.DB, { ...parsed.data, channel: 'human_buyer', requestMerchantReview: parsed.data.requestMerchantReview || requiresMerchantReview(parsed.data.customRequirements ?? []) });
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

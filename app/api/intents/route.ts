import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { DEMO_MERCHANT } from '@/src/adapters/db/seed-data';
import { ensureDatabase } from '@/src/adapters/db/database';

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

  const intentId = crypto.randomUUID();
  const dealId = crypto.randomUUID();
  const publicToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const now = new Date().toISOString();

  if (parsed.data.agentRunId) {
    const run = await env.DB
      .prepare("SELECT id FROM agent_runs WHERE id = ? AND status = 'succeeded'")
      .bind(parsed.data.agentRunId)
      .first<{ id: string }>();
    if (!run) {
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
  }

  const statements = [
    env.DB
      .prepare(
        `INSERT INTO purchase_intents (
          id, merchant_id, raw_text, constraints_json, status, created_at
        ) VALUES (?, ?, ?, ?, 'received', ?)`,
      )
      .bind(
        intentId,
        DEMO_MERCHANT.id,
        parsed.data.rawText,
        JSON.stringify(parsed.data.hardConstraints),
        now,
      ),
    env.DB
      .prepare(
        `INSERT INTO purchase_requirements (
          intent_id, quantity, max_unit_paise, delivery_locations_json, deadline
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        intentId,
        parsed.data.quantity,
        parsed.data.maxUnitPaise,
        JSON.stringify(parsed.data.deliveryLocations),
        parsed.data.deadline,
      ),
    env.DB
      .prepare(
        `INSERT INTO deals (
          id, merchant_id, intent_id, public_token, state, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'intent_received', 1, ?, ?)`,
      )
      .bind(dealId, DEMO_MERCHANT.id, intentId, publicToken, now, now),
    env.DB
      .prepare(
        `INSERT INTO quote_events (
          id, deal_id, quote_id, sequence, event_type, actor_type,
          summary, data_json, created_at
        ) VALUES (?, ?, NULL, 1, 'request_received', 'buyer', ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        dealId,
        'Buyer submitted a bounded purchase mandate.',
        JSON.stringify({
          quantity: parsed.data.quantity,
          maxUnitPaise: parsed.data.maxUnitPaise,
          hardConstraints: parsed.data.hardConstraints,
        }),
        now,
      ),
  ];
  if (parsed.data.agentRunId && parsed.data.agentReviewStatus) {
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO intent_agent_runs (
            intent_id, agent_run_id, review_status, created_at
          ) VALUES (?, ?, ?, ?)`,
        )
        .bind(
          intentId,
          parsed.data.agentRunId,
          parsed.data.agentReviewStatus,
          now,
        ),
    );
  }
  await env.DB.batch(statements);

  return Response.json(
    {
      deal: {
        id: dealId,
        publicToken,
        state: 'intent_received',
        createdAt: now,
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

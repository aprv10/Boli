import { DEMO_MERCHANT } from '@/src/adapters/db/seed-data';
import type { HardConstraint } from '@/src/domain/quoting/types';
import { prepareAuditBatch } from './audit-ledger';

export type SubmitPurchaseIntentInput = {
  selection?: { mode: 'kit' | 'product'; query: string };
  rawText: string;
  hardConstraints: HardConstraint[];
  quantity: number;
  maxUnitPaise: number;
  deliveryLocations: string[];
  deadline: string;
  agentRunId?: string;
  agentReviewStatus?: 'confirmed' | 'modified';
  channel?: 'human_buyer' | 'ai_buyer';
};

export async function submitPurchaseIntent(
  binding: D1Database,
  input: SubmitPurchaseIntentInput,
  now = new Date().toISOString(),
) {
  if (input.agentRunId) {
    const run = await binding
      .prepare("SELECT id FROM agent_runs WHERE id = ? AND status = 'succeeded'")
      .bind(input.agentRunId)
      .first<{ id: string }>();
    if (!run) throw new Error('INVALID_AGENT_TRACE');
  }

  const intentId = crypto.randomUUID();
  const dealId = crypto.randomUUID();
  const publicToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const audit = await prepareAuditBatch(binding, dealId, [
    {
      id: crypto.randomUUID(),
      quoteId: null,
      eventType: 'request_received',
      actorType: 'buyer',
      summary: 'Buyer submitted a bounded purchase mandate.',
      data: {
        quantity: input.quantity,
        maxUnitPaise: input.maxUnitPaise,
        hardConstraints: input.hardConstraints,
        deliveryLocations: input.deliveryLocations,
        deadline: input.deadline,
        selection: input.selection ?? { mode: 'kit', query: '' },
        channel: input.channel ?? (input.agentRunId ? 'ai_buyer' : 'human_buyer'),
      },
      createdAt: now,
    },
  ]);
  const statements: D1PreparedStatement[] = [
    binding
      .prepare(
        `INSERT INTO purchase_intents (
          id, merchant_id, raw_text, constraints_json, status, created_at
        ) VALUES (?, ?, ?, ?, 'received', ?)`,
      )
      .bind(
        intentId,
        DEMO_MERCHANT.id,
        input.rawText,
        JSON.stringify(input.hardConstraints),
        now,
      ),
    binding
      .prepare(
        `INSERT INTO purchase_requirements (
          intent_id, quantity, max_unit_paise, delivery_locations_json, deadline, selection_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        intentId,
        input.quantity,
        input.maxUnitPaise,
        JSON.stringify(input.deliveryLocations),
        input.deadline,
        input.selection ? JSON.stringify(input.selection) : null,
      ),
    binding
      .prepare(
        `INSERT INTO deals (
          id, merchant_id, intent_id, public_token, state, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'intent_received', 1, ?, ?)`,
      )
      .bind(dealId, DEMO_MERCHANT.id, intentId, publicToken, now, now),
    ...audit.statements,
  ];
  if (input.agentRunId && input.agentReviewStatus) {
    statements.push(
      binding
        .prepare(
          `INSERT INTO intent_agent_runs (
            intent_id, agent_run_id, review_status, created_at
          ) VALUES (?, ?, ?, ?)`,
        )
        .bind(intentId, input.agentRunId, input.agentReviewStatus, now),
    );
  }
  await binding.batch(statements);

  return { id: dealId, intentId, publicToken, state: 'intent_received' as const, createdAt: now };
}

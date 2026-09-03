import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import {
  interpretRfqWithMistral,
  MISTRAL_MODEL,
  MistralInterpreterError,
} from '@/src/application/agent/mistral-interpreter';

const inputSchema = z.object({
  brief: z.string().trim().min(3).max(600),
});

export async function POST(request: Request) {
  await ensureDatabase(env.DB);
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Add a little more detail before asking Boli to interpret the request.',
        },
      },
      { status: 400 },
    );
  }

  const apiKey = env.MISTRAL_API_KEY ?? process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error: {
          code: 'AI_NOT_CONFIGURED',
          message:
            'Mistral is not connected locally. Configure MISTRAL_API_KEY on the server, or enter your requirements manually.',
        },
      },
      { status: 503 },
    );
  }

  const runId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const startedAt = performance.now();

  try {
    const result = await interpretRfqWithMistral({
      brief: parsed.data.brief,
      apiKey,
      currentDate: createdAt.slice(0, 10),
    });
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    await env.DB
      .prepare(
        `INSERT INTO agent_runs (
          id, provider, model, operation, status, input_json, output_json,
          prompt_tokens, completion_tokens, total_tokens, latency_ms,
          failure_code, created_at
        ) VALUES (?, 'mistral', ?, 'interpret_rfq', 'succeeded', ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(
        runId,
        result.model,
        JSON.stringify({ brief: parsed.data.brief }),
        JSON.stringify(result.interpretation),
        result.usage.promptTokens,
        result.usage.completionTokens,
        result.usage.totalTokens,
        latencyMs,
        createdAt,
      )
      .run();

    return Response.json({
      runId,
      provider: 'mistral',
      model: result.model,
      interpretation: result.interpretation,
      usage: result.usage,
      latencyMs,
      authority: 'DRAFT_REQUIRES_BUYER_CONFIRMATION',
    });
  } catch (error) {
    const failure =
      error instanceof MistralInterpreterError
        ? error
        : new MistralInterpreterError(
            'PROVIDER_UNAVAILABLE',
            'The interpretation failed. No draft fields were changed.',
          );
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    await env.DB
      .prepare(
        `INSERT INTO agent_runs (
          id, provider, model, operation, status, input_json, output_json,
          prompt_tokens, completion_tokens, total_tokens, latency_ms,
          failure_code, created_at
        ) VALUES (?, 'mistral', ?, 'interpret_rfq', 'failed', ?, ?, 0, 0, 0, ?, ?, ?)`,
      )
      .bind(
        runId,
        MISTRAL_MODEL,
        JSON.stringify({ brief: parsed.data.brief }),
        JSON.stringify({ code: failure.code, providerStatus: failure.providerStatus, providerCode: failure.providerCode }),
        latencyMs,
        failure.code,
        createdAt,
      )
      .run();

    return Response.json(
      { error: { code: failure.code, message: failure.message }, runId },
      { status: 502 },
    );
  }
}

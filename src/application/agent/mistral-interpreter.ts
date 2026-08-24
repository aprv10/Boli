import {
  RFQ_INTERPRETATION_JSON_SCHEMA,
  rfqInterpretationSchema,
  type RfqInterpretation,
} from './rfq-contract';

export const MISTRAL_MODEL = 'mistral-small-2603';
const MISTRAL_CHAT_URL = 'https://api.mistral.ai/v1/chat/completions';
const MAX_OUTPUT_TOKENS = 320;

type MistralResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export class MistralInterpreterError extends Error {
  constructor(
    public code: 'PROVIDER_UNAVAILABLE' | 'INVALID_PROVIDER_OUTPUT',
    message: string,
  ) {
    super(message);
  }
}

export type InterpretRfqResult = {
  interpretation: RfqInterpretation;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: typeof MISTRAL_MODEL;
};

export async function interpretRfqWithMistral({
  brief,
  apiKey,
  currentDate,
  fetchImpl = fetch,
}: {
  brief: string;
  apiKey: string;
  currentDate: string;
  fetchImpl?: typeof fetch;
}): Promise<InterpretRfqResult> {
  let response: Response;
  try {
    response = await fetchImpl(MISTRAL_CHAT_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        messages: [
          {
            role: 'system',
            content:
              `Extract a corporate-gifting purchase mandate. Today is ${currentDate}. ` +
              'Never invent missing facts. Preserve hard constraints. Resolve a relative date only when unambiguous. ' +
              'Record the stated budget without dividing a total budget. Use budgetKind=total when the buyer gives only an order total. ' +
              'Return concise evidence copied from the request. Do not recommend products, calculate quotes, approve spending, or call tools.',
          },
          { role: 'user', content: brief },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'boli_rfq_interpretation',
            description: 'A non-authoritative draft purchase mandate for buyer review.',
            schema: RFQ_INTERPRETATION_JSON_SCHEMA,
            strict: true,
          },
        },
        reasoning_effort: 'none',
        temperature: 0,
        random_seed: 17,
        max_tokens: MAX_OUTPUT_TOKENS,
        n: 1,
        stream: false,
        prompt_cache_key: 'boli-rfq-v1',
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new MistralInterpreterError(
      'PROVIDER_UNAVAILABLE',
      'Mistral could not be reached. Your structured buying rails are still available.',
    );
  }

  if (!response.ok) {
    throw new MistralInterpreterError(
      'PROVIDER_UNAVAILABLE',
      'Mistral rejected or could not complete the request. No automatic retry was made.',
    );
  }

  const payload = (await response.json()) as MistralResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new MistralInterpreterError(
      'INVALID_PROVIDER_OUTPUT',
      'Mistral returned no structured mandate.',
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    throw new MistralInterpreterError(
      'INVALID_PROVIDER_OUTPUT',
      'Mistral returned malformed JSON. Nothing was applied.',
    );
  }
  const parsed = rfqInterpretationSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new MistralInterpreterError(
      'INVALID_PROVIDER_OUTPUT',
      'Mistral returned an invalid mandate. Nothing was applied.',
    );
  }

  const promptTokens = payload.usage?.prompt_tokens ?? 0;
  const completionTokens = payload.usage?.completion_tokens ?? 0;
  return {
    interpretation: parsed.data,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: payload.usage?.total_tokens ?? promptTokens + completionTokens,
    },
    model: MISTRAL_MODEL,
  };
}

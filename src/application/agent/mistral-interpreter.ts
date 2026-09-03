import {
  RFQ_INTERPRETATION_JSON_SCHEMA,
  rfqInterpretationSchema,
  type RfqInterpretation,
} from './rfq-contract';

export const MISTRAL_MODEL = 'mistral-small-2603';
const MISTRAL_CHAT_URL = 'https://api.mistral.ai/v1/chat/completions';
const MAX_OUTPUT_TOKENS = 650;

type MistralResponse = {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export class MistralInterpreterError extends Error {
  constructor(
    public code: 'PROVIDER_UNAVAILABLE' | 'INVALID_PROVIDER_OUTPUT' | 'PROVIDER_SCHEMA_REJECTED' |
      'PROVIDER_AUTH_FAILED' | 'PROVIDER_QUOTA_EXCEEDED' | 'PROVIDER_RATE_LIMITED' |
      'PROVIDER_REQUEST_REJECTED' | 'PROVIDER_TIMEOUT' | 'PROVIDER_OUTPUT_TRUNCATED',
    message: string,
    public providerStatus?: number,
    public providerCode?: string,
  ) {
    super(message);
  }
}

async function providerFailure(response: Response): Promise<MistralInterpreterError> {
  // Never expose the provider's raw body: it may echo prompts or credentials.
  const body: unknown = await response.json().catch(() => null);
  const rawCode = body && typeof body === 'object' && 'code' in body ? String(body.code) : '';
  const code = /^[a-zA-Z0-9_-]{1,80}$/.test(rawCode) ? rawCode : undefined;
  const status = response.status;
  if (status === 401 || status === 403) return new MistralInterpreterError('PROVIDER_AUTH_FAILED', 'Mistral rejected the configured API credentials. Check the server’s MISTRAL_API_KEY or enter your requirements manually.', status, code);
  if (status === 402) return new MistralInterpreterError('PROVIDER_QUOTA_EXCEEDED', 'Mistral’s API quota or billing limit was reached. Check the Mistral account or enter your requirements manually.', status, code);
  if (status === 429) return new MistralInterpreterError('PROVIDER_RATE_LIMITED', 'Mistral is rate-limiting requests. Try again shortly or enter your requirements manually.', status, code);
  if (status === 400 && code === '3051') return new MistralInterpreterError('PROVIDER_SCHEMA_REJECTED', 'Mistral rejected Boli’s structured-output schema. This is an integration error, not a problem with your request. You can enter the details manually.', status, code);
  if (status >= 400 && status < 500) return new MistralInterpreterError('PROVIDER_REQUEST_REJECTED', 'Mistral rejected Boli’s interpretation request. You can enter the details manually while the integration is checked.', status, code);
  return new MistralInterpreterError('PROVIDER_UNAVAILABLE', 'Mistral is temporarily unavailable. Try again shortly or enter your requirements manually.', status, code);
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
              `Extract a shopping request. Today is ${currentDate}. ` +
              'Use shoppingMode=kit only for explicit welcome/onboarding kits; product for one product type (bottles, notebooks, mugs etc.), otherwise unknown. ' +
              'productQuery must contain only the requested product type/name/material, not quantities, budgets, cities or dates. Never turn a product request into a kit. ' +
              'Supported fields are one product type/name/material, quantity, budget, delivery cities, deadline, and vegan/plastic-free/branded/multi-city constraints. Product material such as steel belongs in productQuery, not unsupportedRequirements. For mixed product types, other bundle types, or additional restrictions not represented by those fields (such as certifications or nut allergies), add the exact unmet requirement to unsupportedRequirements. ' +
              'If there are no dietary or packaging requirements, hardConstraints must be empty. Never add default cities, dates, budgets, or quantities. ' +
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
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new MistralInterpreterError('PROVIDER_TIMEOUT', 'Mistral took too long to respond. Try again or enter your requirements manually.');
    }
    throw new MistralInterpreterError(
      'PROVIDER_UNAVAILABLE',
      'Boli could not connect to Mistral. Check connectivity or enter your requirements manually.',
    );
  }

  if (!response.ok) {
    throw await providerFailure(response);
  }

  const payload = (await response.json().catch(() => null)) as MistralResponse | null;
  if (payload?.choices?.[0]?.finish_reason === 'length') {
    throw new MistralInterpreterError('PROVIDER_OUTPUT_TRUNCATED', 'Mistral returned an incomplete response. Shorten the request or enter your requirements manually.');
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content) {
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

  const promptTokens = payload?.usage?.prompt_tokens ?? 0;
  const completionTokens = payload?.usage?.completion_tokens ?? 0;
  return {
    interpretation: parsed.data,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: payload?.usage?.total_tokens ?? promptTokens + completionTokens,
    },
    model: MISTRAL_MODEL,
  };
}

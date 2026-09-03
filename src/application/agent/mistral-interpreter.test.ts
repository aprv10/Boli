import { describe, expect, it, vi } from 'vitest';
import {
  interpretRfqWithMistral,
  MISTRAL_MODEL,
  MistralInterpreterError,
} from './mistral-interpreter';
import { RFQ_INTERPRETATION_JSON_SCHEMA, rfqInterpretationSchema } from './rfq-contract';

const validInterpretation = {
  requestTitle: 'Employee welcome kits',
  quantity: 120,
  budgetKind: 'per_unit',
  budgetInr: 900,
  deliveryLocations: ['Bengaluru', 'Pune'],
  deadline: '2026-08-28',
  hardConstraints: ['vegan', 'plastic-free', 'branded', 'multi-city'],
  missingFields: [],
  clarifyingQuestion: null,
  evidence: {
    quantity: '120',
    budget: 'under ₹900',
    delivery: 'Bengaluru and Pune',
    deadline: 'by Friday',
    constraints: ['vegan', 'plastic-free', 'add our logo', 'split delivery'],
  },
};

describe('Mistral RFQ interpreter', () => {
  it('uses one capped, non-reasoning structured-output call', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(validInterpretation) } }],
          usage: { prompt_tokens: 190, completion_tokens: 104, total_tokens: 294 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await interpretRfqWithMistral({
      brief:
        'I need 120 vegan, plastic-free welcome kits under ₹900 each for Bengaluru and Pune by Friday, with our logo.',
      apiKey: 'test-key',
      currentDate: '2026-08-25',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: MISTRAL_MODEL,
      max_tokens: 650,
      reasoning_effort: 'none',
      temperature: 0,
      n: 1,
    });
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'boli_rfq_interpretation', strict: true },
    });
    expect(result.interpretation.quantity).toBe(120);
    expect(result.usage.totalTokens).toBe(294);
  });

  it('rejects values outside Boli input boundaries', () => {
    expect(
      rfqInterpretationSchema.safeParse({ ...validInterpretation, quantity: 0 }).success,
    ).toBe(false);
    expect(rfqInterpretationSchema.safeParse({ ...validInterpretation, quantity: 1 }).success).toBe(true);
    expect(rfqInterpretationSchema.safeParse({ ...validInterpretation, deadline: '2026-02-30' }).success).toBe(false);
    expect(rfqInterpretationSchema.safeParse({ ...validInterpretation, productQuery: 'x'.repeat(121) }).success).toBe(false);
    expect(rfqInterpretationSchema.safeParse({ ...validInterpretation, hardConstraints: ['invented'] }).success).toBe(false);
  });

  it('keeps range, length and calendar validation out of the provider grammar', () => {
    const schema = JSON.stringify(RFQ_INTERPRETATION_JSON_SCHEMA);
    for (const keyword of ['minimum', 'maximum', 'minLength', 'maxLength', 'maxItems', 'uniqueItems', 'format']) {
      expect(schema).not.toContain(`"${keyword}":`);
    }
    expect(RFQ_INTERPRETATION_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(RFQ_INTERPRETATION_JSON_SCHEMA.required).toContain('deadline');
  });

  it('distinguishes schema rejection without exposing a raw provider body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      code: '3051', message: 'Invalid structured output syntax; secret-test-key; buyer text',
    }), { status: 400 }));
    const error = await interpretRfqWithMistral({ brief: '30 kits for Chennai', apiKey: 'secret-test-key', currentDate: '2026-09-02', fetchImpl }).catch(error => error as MistralInterpreterError);
    expect(error).toMatchObject({ code: 'PROVIDER_SCHEMA_REJECTED', providerStatus: 400, providerCode: '3051' });
    expect(JSON.stringify(error)).not.toContain('secret-test-key');
    expect(JSON.stringify(error)).not.toContain('buyer text');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'PROVIDER_AUTH_FAILED'], [402, 'PROVIDER_QUOTA_EXCEEDED'],
    [429, 'PROVIDER_RATE_LIMITED'], [503, 'PROVIDER_UNAVAILABLE'],
  ])('classifies provider HTTP %s failures', async (status, code) => {
    await expect(interpretRfqWithMistral({
      brief: '30 kits for Chennai', apiKey: 'test-key', currentDate: '2026-09-02',
      fetchImpl: async () => new Response(null, { status }),
    })).rejects.toMatchObject({ code, providerStatus: status });
  });

  it('rejects truncated output before accepting a partial interpretation', async () => {
    await expect(interpretRfqWithMistral({
      brief: '30 kits for Chennai', apiKey: 'test-key', currentDate: '2026-09-02',
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(validInterpretation) } }] }), { status: 200 }),
    })).rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_TRUNCATED' });
  });

  it('fails closed when provider JSON is malformed', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{not-json' } }] }),
        { status: 200 },
      ),
    );

    await expect(
      interpretRfqWithMistral({
        brief: 'I need a detailed corporate gifting order with quantity and budget included.',
        apiKey: 'test-key',
        currentDate: '2026-08-25',
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_OUTPUT',
    } satisfies Partial<MistralInterpreterError>);
  });

  it('does not retry a rejected provider request', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 429 }));

    await expect(
      interpretRfqWithMistral({
        brief: 'I need a detailed corporate gifting order with quantity and budget included.',
        apiKey: 'test-key',
        currentDate: '2026-08-25',
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' } satisfies Partial<MistralInterpreterError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

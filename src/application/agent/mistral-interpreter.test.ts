import { describe, expect, it, vi } from 'vitest';
import {
  interpretRfqWithMistral,
  MISTRAL_MODEL,
  MistralInterpreterError,
} from './mistral-interpreter';
import { rfqInterpretationSchema } from './rfq-contract';

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
      max_tokens: 320,
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
      rfqInterpretationSchema.safeParse({ ...validInterpretation, quantity: 1 }).success,
    ).toBe(false);
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
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' } satisfies Partial<MistralInterpreterError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

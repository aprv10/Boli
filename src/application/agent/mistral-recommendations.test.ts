import { describe, expect, it, vi } from 'vitest';
import { recommendWithMistral, recommendationExplanation, validateRecommendation, type RecommendationCandidate } from './mistral-recommendations';

const candidates: RecommendationCandidate[] = [
  { id: 'cheap', name: 'Cheapest', facts: [{ id: 'price', text: '₹800 per kit.' }] },
  { id: 'quick', name: 'Fastest', facts: [{ id: 'delivery', text: 'Catalog lead time: 2 days.' }] },
];
const output = { ranking: [{ id: 'quick', factIds: ['delivery'] }, { id: 'cheap', factIds: ['price'] }] };
const provider = (content: unknown) => vi.fn<typeof fetch>(async () => Response.json({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
}));

describe('grounded Mistral recommendations', () => {
  it('ranks eligible IDs and renders only backend facts with one bounded call', async () => {
    const fetchImpl = provider(output);
    const result = await recommendWithMistral({ kind: 'option_ranking', context: { rawText: 'Prioritize fast delivery' }, candidates, apiKey: 'test-key', fetchImpl });
    expect(result).toMatchObject({ source: 'mistral', ranking: output.ranking, fallbackReason: null });
    expect(recommendationExplanation(candidates[1], result.ranking[0].factIds)).toBe('Catalog lead time: 2 days.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ reasoning_effort: 'none', temperature: 0, max_tokens: 1200,
      response_format: { type: 'json_schema', json_schema: { strict: true } } });
    expect(init?.signal).toBeDefined();
    expect(JSON.stringify(body)).not.toContain('test-key');
    expect(JSON.stringify(result)).not.toContain('test-key');
  });

  it.each([
    { ranking: [{ id: 'invented-product', factIds: ['price'] }, output.ranking[0]] },
    { ranking: [output.ranking[0], output.ranking[0]] },
    { ranking: [output.ranking[0]] },
    { ranking: [{ id: 'quick', factIds: ['price'] }, output.ranking[1]] },
    { ranking: [{ id: 'quick', factIds: ['delivery', 'delivery'] }, output.ranking[1]] },
    { ranking: [{ id: 'quick', factIds: [] }, output.ranking[1]] },
    { ...output, price: 1 },
    { ranking: [{ ...output.ranking[0], paymentApproved: true }, output.ranking[1]] },
  ])('rejects unknown, duplicated, missing, cross-candidate or authoritative output: %j', invalid => {
    expect(validateRecommendation(invalid, candidates)).toBeNull();
  });

  it('falls back without labeling invalid recommendations as AI', async () => {
    const result = await recommendWithMistral({ kind: 'option_ranking', context: {}, candidates, apiKey: 'test-key', fetchImpl: provider({ price: 1 }) });
    expect(result).toMatchObject({ source: 'deterministic', model: null, fallbackReason: 'invalid_output' });
    expect(result.ranking.map(item => item.id)).toEqual(['cheap', 'quick']);
  });

  it('skips the provider when no key or no ranking choice exists', async () => {
    const fetchImpl = provider(output);
    expect(await recommendWithMistral({ kind: 'option_ranking', context: {}, candidates, fetchImpl }))
      .toMatchObject({ source: 'deterministic', fallbackReason: 'not_configured' });
    expect(await recommendWithMistral({ kind: 'option_ranking', context: {}, candidates: [candidates[0]], apiKey: 'key', fetchImpl }))
      .toMatchObject({ source: 'deterministic', fallbackReason: 'single_option' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses Mistral for eligible upsell selection, including a single eligible item', async () => {
    const fetchImpl = provider({ ranking: [{ id: 'cheap', factIds: ['price'] }] });
    expect(await recommendWithMistral({ kind: 'upsell_selection', context: {}, candidates: [candidates[0]], apiKey: 'key', fetchImpl }))
      .toMatchObject({ source: 'mistral', ranking: [{ id: 'cheap', factIds: ['price'] }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back on provider failure, timeout and truncated output', async () => {
    for (const fetchImpl of [
      vi.fn<typeof fetch>(async () => new Response('private provider error', { status: 429 })),
      vi.fn<typeof fetch>(async () => { throw new DOMException('timeout', 'TimeoutError'); }),
      vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(output) } }] })),
    ]) {
      const result = await recommendWithMistral({ kind: 'option_ranking', context: {}, candidates, apiKey: 'key', fetchImpl });
      expect(result.source).toBe('deterministic');
      expect(result.ranking[0].id).toBe('cheap');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});

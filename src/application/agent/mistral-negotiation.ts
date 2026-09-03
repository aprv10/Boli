import { MISTRAL_MODEL } from './mistral-interpreter';

type NegotiationInterpretation = { targetUnitPaise: number; condition: string | null };
export class UnclearNegotiationTarget extends Error {}

function deterministicFallback(message: string): NegotiationInterpretation {
  if (/total|entire|whole|%|percent|\boff\b|\badd\b|\binclude\b|\bremove\b|\bfree\b/i.test(message)) throw new UnclearNegotiationTarget('Enter only your final target price per item.');
  const normalized = message.replaceAll(',', '');
  const amounts = [...normalized.matchAll(/(?:₹|\brs\.?|\binr)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:\/|per)\s*(?:person|kit|unit|item|bottle)/gi)];
  if (amounts.length !== 1) throw new UnclearNegotiationTarget('Enter one target price per item.');
  const value = Math.round(Number(amounts[0][1] ?? amounts[0][2]) * 100);
  if (value < 100 || value > 10_000_000) throw new UnclearNegotiationTarget('Enter a valid unit price.');
  return { targetUnitPaise: value, condition: /i(?:'|’)ll take it/i.test(message) ? message : null };
}

export async function interpretNegotiationRequest({ message, apiKey }: { message: string; apiKey?: string }) {
  if (apiKey) {
    try {
      const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MISTRAL_MODEL,
          messages: [
            { role: 'system', content: 'Extract one explicitly requested unit price in integer INR paise and any non-binding purchase commitment. Return null target if ambiguous, a percentage only, a total order budget, no price was stated, or the message changes products, quantity, delivery or requirements. Only a unit price target is supported here. Never invent a price or approve a discount, payment or transaction. ₹250 per bottle = 25000 paise.' },
            { role: 'user', content: message },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'boli_negotiation_intent', strict: true, schema: { type: 'object', additionalProperties: false, required: ['targetUnitPaise', 'condition'], properties: { targetUnitPaise: { type: ['integer', 'null'] }, condition: { type: ['string', 'null'] } } } } },
          temperature: 0, max_tokens: 140,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('provider');
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? '{}') as Partial<NegotiationInterpretation>;
      if (parsed.targetUnitPaise == null) throw new UnclearNegotiationTarget('Enter a target unit price.');
      if (!Number.isSafeInteger(parsed.targetUnitPaise) || parsed.targetUnitPaise < 100 || parsed.targetUnitPaise > 10_000_000) throw new Error('provider');
      return { targetUnitPaise: parsed.targetUnitPaise, condition: typeof parsed.condition === 'string' ? parsed.condition : null, interpreter: 'mistral' as const };
    } catch (error) {
      if (error instanceof UnclearNegotiationTarget) throw error;
    }
  }
  return { ...deterministicFallback(message), interpreter: 'deterministic_fallback' as const };
}

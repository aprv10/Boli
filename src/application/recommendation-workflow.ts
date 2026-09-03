import { prepareAuditBatch } from './audit-ledger';
import type { DealQuoteWorkspace } from './quote-workflow';
import {
  fallbackRecommendation, recommendWithMistral, recommendationExplanation, validateRecommendation,
  type Recommendation, type RecommendationCandidate, type RecommendationKind,
} from './agent/mistral-recommendations';
import { MISTRAL_MODEL } from './agent/mistral-interpreter';
import { requiresMerchantReview } from '@/src/domain/quoting/custom-requirements';

export async function recordedRecommendation(binding: D1Database, input: {
  dealId: string; quoteId?: string; kind: RecommendationKind;
  context: Record<string, unknown>; candidates: RecommendationCandidate[]; apiKey?: string;
}): Promise<Recommendation> {
  const inputBytes = new TextEncoder().encode(JSON.stringify({ version: 1, model: MISTRAL_MODEL,
    configured: Boolean(input.apiKey), kind: input.kind, context: input.context, candidates: input.candidates }));
  const inputHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', inputBytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const eventType = input.kind === 'option_ranking' ? 'options_ranked' : 'upsell_recommended';
  const saved = await binding.prepare(`SELECT data_json AS dataJson, created_at AS createdAt FROM quote_events
    WHERE deal_id = ? AND event_type = ? AND json_extract(data_json, '$.inputHash') = ? ORDER BY sequence DESC LIMIT 1`)
    .bind(input.dealId, eventType, inputHash).first<{ dataJson: string; createdAt: string }>();
  if (saved) {
    const data = JSON.parse(saved.dataJson) as Recommendation;
    const ranking = validateRecommendation({ ranking: data.ranking }, input.candidates);
    // Retry transient provider failures after a short cooldown. Valid choices are
    // reused only when the reviewed mandate and eligible candidate facts match.
    const retryable = data.fallbackReason === 'provider_unavailable' || data.fallbackReason === 'invalid_output';
    if (ranking && (!retryable || Date.now() - Date.parse(saved.createdAt) < 30_000)) {
      return { source: data.source, model: data.model, fallbackReason: data.fallbackReason, ranking };
    }
  }
  const result = await recommendWithMistral(input);
  const selected = input.candidates.find(candidate => candidate.id === result.ranking[0]?.id);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const audit = await prepareAuditBatch(binding, input.dealId, [{
        id: crypto.randomUUID(), quoteId: input.quoteId ?? null, eventType, actorType: 'system',
        summary: `${result.source === 'mistral' ? 'Mistral' : 'Backend fallback'} ${input.kind === 'option_ranking' ? 'ranked eligible options' : 'suggested an eligible add-on'}${selected ? `: ${selected.name}` : ''}. Advice only; no offer or payment authorized.`,
        data: { ...result, inputHash, candidates: input.candidates, authority: 'advisory_only' },
        createdAt: new Date().toISOString(),
      }]);
      await binding.batch(audit.statements);
      return result;
    } catch {
      // A concurrent transaction may have advanced the hash-chain head. Retry
      // recording, never rerun the model or touch the commercial transaction.
    }
  }
  // Recommendation logging must not block shopping or label unrecorded advice as AI.
  return fallbackRecommendation(input.candidates, 'provider_unavailable');
}

export function recommendationContext(workspace: DealQuoteWorkspace) {
  const { rawText, selection, customRequirements, quantity, maxUnitPaise, deliveryLocations, deadline, hardConstraints } = workspace.deal;
  return { rawText, reviewedMandate: { selection, customRequirements, quantity, maxUnitPaise, deliveryLocations, deadline, hardConstraints },
    policyVersion: workspace.policy.version, date: workspace.evaluatedAt.slice(0, 10) };
}

const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);

export async function rankDealOptions(binding: D1Database, workspace: DealQuoteWorkspace, apiKey?: string) {
  const options = workspace.result.status === 'generated' ? workspace.result.options : [];
  if (!options.length || requiresMerchantReview(workspace.deal.customRequirements)) {
    return options.map(option => ({ ...option, recommendationSource: 'deterministic' as const }));
  }
  const candidates: RecommendationCandidate[] = [...options]
    .sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)))
    .map(option => ({ id: option.key, name: option.label, facts: [
      { id: 'price', text: `${money(option.unitTotalPaise)} per ${workspace.deal.selection?.mode === 'product' ? 'item' : 'kit'}; ${money(option.orderTotalPaise)} total.` },
      { id: 'delivery', text: `Catalog lead time: ${option.checks.find(check => check.code === 'LEAD_TIME_FEASIBLE')?.observed ?? 'not specified'}.` },
      { id: 'headroom', text: `${money(option.headroomPaise)} per unit remains within your budget.` },
      { id: 'products', text: `Includes ${option.lines.filter(line => line.kind === 'product').map(line => line.label).join(', ')}.` },
      ...(workspace.deal.hardConstraints.length ? [{ id: 'constraints', text: `Passes ${workspace.deal.hardConstraints.join(', ')} checks.` }] : []),
    ] }));
  const result = await recordedRecommendation(binding, { dealId: workspace.deal.id, kind: 'option_ranking',
    context: recommendationContext(workspace), candidates, apiKey });
  // Only display order, recommendation and grounded explanation change. Quote
  // selection still regenerates the original deterministic option by its key.
  return result.ranking.map((item, index) => {
    const option = options.find(option => option.key === item.id)!;
    return { ...option, recommended: index === 0, recommendationSource: result.source,
      rationale: result.source === 'mistral'
        ? recommendationExplanation(candidates.find(candidate => candidate.id === item.id)!, item.factIds)
        : option.rationale };
  });
}

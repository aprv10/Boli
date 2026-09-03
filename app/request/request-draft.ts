import { z } from 'zod';
import { customRequirementsSchema } from '@/src/domain/quoting/custom-requirements';
import type { RfqInterpretation } from '@/src/application/agent/rfq-contract';
import { purchaseIntentInput } from '@/src/application/purchase-contract';
export const draftSchema = z.object({
  quantity: z.string().max(10), budget: z.string().max(20), budgetKind: z.enum(['per_unit','total']),
  locations: z.string().max(800), deadline: z.string().max(10), mode: z.enum(['','kit','product']), query: z.string().max(120),
  constraints: z.array(z.enum(['vegan','plastic-free','branded','multi-city'])).max(4), custom: customRequirementsSchema,
});
export type Draft = z.infer<typeof draftSchema>;
export const emptyDraft = (): Draft => ({ quantity: '', budget: '', budgetKind: 'per_unit', locations: '', deadline: '', mode: '', query: '', constraints: [], custom: [] });

export function draftFromInterpretation(value: RfqInterpretation): Draft {
  return { quantity: value.quantity == null ? '' : String(value.quantity), budget: value.budgetInr == null ? '' : String(value.budgetInr),
    budgetKind: value.budgetKind === 'total' ? 'total' : 'per_unit', locations: value.deliveryLocations.join(', '),
    deadline: value.deadline ?? '', mode: value.shoppingMode === 'unknown' ? '' : value.shoppingMode, query: value.productQuery,
    constraints: value.hardConstraints, custom: value.unsupportedRequirements.map(text => ({ text, priority: 'required' })) };
}

export function purchaseInputFromDraft(brief: string, draft: Draft, runId = '') {
  const quantity = Number(draft.quantity);
  const budgetPaise = Math.round(Number(draft.budget) * 100);
  return purchaseIntentInput.safeParse({ rawText: brief, quantity,
    maxUnitPaise: draft.budgetKind === 'total' ? Math.floor(budgetPaise / quantity) : budgetPaise,
    deliveryLocations: draft.locations.split(',').map(value => value.trim()).filter(Boolean),
    deadline: draft.deadline, hardConstraints: draft.constraints,
    selection: { mode: draft.mode, query: draft.query }, customRequirements: draft.custom,
    ...(runId ? { agentRunId: runId, agentReviewStatus: 'modified' } : {}),
  });
}
const savedSchema = z.object({ brief: z.string().max(600), draft: draftSchema, runId: z.string().max(40), notice: z.string().max(1000).optional(), question: z.string().max(600).optional() });
const KEY = 'boli.request.v2';
export function saveDraft(value: z.infer<typeof savedSchema>) {
  try { sessionStorage.setItem(KEY, JSON.stringify(value)); return true; } catch { return false; }
}
export function readDraft() {
  try { const parsed = savedSchema.safeParse(JSON.parse(sessionStorage.getItem(KEY) ?? 'null')); return parsed.success ? parsed.data : null; } catch { return null; }
}

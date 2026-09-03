import { z } from 'zod';
import { customRequirementsSchema } from '@/src/domain/quoting/custom-requirements';

// Human and agent entry points share the same mandate boundaries.
export const purchaseIntentInput = z.object({
  rawText: z.string().trim().min(3).max(600),
  selection: z.object({ mode: z.enum(['kit', 'product']), query: z.string().trim().max(120) }).refine(value => value.mode === 'kit' || value.query.length > 1).optional(),
  unsupportedRequirements: z.array(z.string()).max(0).optional(),
  customRequirements: customRequirementsSchema.optional(),
  requestMerchantReview: z.boolean().optional(),
  hardConstraints: z
    .array(z.enum(['vegan', 'plastic-free', 'branded', 'multi-city']))
    .max(8),
  quantity: z.number().int().min(1).max(10_000),
  maxUnitPaise: z.number().int().min(100).max(10_000_000),
  deliveryLocations: z.array(z.string().trim().min(2).max(80)).min(1).max(10),
  deadline: z.iso.date().refine(value => value >= new Date().toISOString().slice(0, 10), 'Choose today or a future delivery date.'),
  agentRunId: z.uuid().optional(),
  agentReviewStatus: z.enum(['confirmed', 'modified']).optional(),
}).refine(
  (value) => Boolean(value.agentRunId) === Boolean(value.agentReviewStatus),
  { message: 'AI trace and review status must be provided together.' },
).refine(value => !value.hardConstraints.includes('multi-city') || new Set(value.deliveryLocations.map(city => city.toLowerCase())).size >= 2, { message: 'Add at least two different delivery cities or remove the multi-city requirement.' });

export type PurchaseIntentInput = z.infer<typeof purchaseIntentInput>;

import { z } from 'zod';

export const hardConstraintSchema = z.enum([
  'vegan',
  'plastic-free',
  'branded',
  'multi-city',
]);

export const rfqInterpretationSchema = z.object({
  shoppingMode: z.enum(['kit', 'product', 'unknown']).default('unknown'),
  productQuery: z.string().max(120).default(''),
  unsupportedRequirements: z.array(z.string().max(160)).max(10).default([]),
  requestTitle: z.string().trim().min(3).max(80),
  quantity: z.number().int().min(1).max(10_000).nullable(),
  budgetKind: z.enum(['per_unit', 'total', 'unknown']),
  budgetInr: z.number().min(1).max(10_000_000).nullable(),
  deliveryLocations: z.array(z.string().trim().min(2).max(80)).max(10),
  deadline: z.iso.date().nullable(),
  hardConstraints: z.array(hardConstraintSchema).max(4),
  missingFields: z
    .array(
      z.enum(['quantity', 'budget_per_kit', 'delivery_locations', 'deadline']),
    )
    .max(4),
  clarifyingQuestion: z.string().trim().min(5).max(180).nullable(),
  evidence: z.object({
    quantity: z.string().max(100).nullable(),
    budget: z.string().max(100).nullable(),
    delivery: z.string().max(140).nullable(),
    deadline: z.string().max(100).nullable(),
    constraints: z.array(z.string().max(100)).max(4),
  }),
});

export type RfqInterpretation = z.infer<typeof rfqInterpretationSchema>;

// Keep the provider grammar structural. Bounds, date validity and string/array
// limits are enforced by rfqInterpretationSchema after generation, not by
// Mistral's more limited structured-output grammar compiler.
export const RFQ_INTERPRETATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    shoppingMode: { type: 'string', enum: ['kit', 'product', 'unknown'] },
    productQuery: { type: 'string', description: 'Product type/name/material only; at most 120 characters. Empty for kits or unknown requests.' },
    unsupportedRequirements: { type: 'array', items: { type: 'string' }, description: 'At most 10 requirements, each at most 160 characters.' },
    requestTitle: { type: 'string', description: 'A short title, 3–80 characters.' },
    quantity: { type: ['integer', 'null'], description: 'Explicit quantity from 1 to 10000, or null if unstated.' },
    budgetKind: { type: 'string', enum: ['per_unit', 'total', 'unknown'] },
    budgetInr: { type: ['number', 'null'], description: 'Stated INR amount, or null if unstated. Do not calculate a per-unit amount from a total.' },
    deliveryLocations: {
      type: 'array',
      items: { type: 'string' },
      description: 'At most 10 stated cities, each 2–80 characters. Empty when unstated.',
    },
    deadline: { type: ['string', 'null'], description: 'A real calendar date in YYYY-MM-DD format, or null when unstated or ambiguous.' },
    hardConstraints: {
      type: 'array',
      description: 'Only requested constraints, with no duplicates. Empty when none are stated.',
      items: {
        type: 'string',
        enum: ['vegan', 'plastic-free', 'branded', 'multi-city'],
      },
    },
    missingFields: {
      type: 'array',
      description: 'Missing required buying details, without duplicates.',
      items: {
        type: 'string',
        enum: ['quantity', 'budget_per_kit', 'delivery_locations', 'deadline'],
      },
    },
    clarifyingQuestion: {
      type: ['string', 'null'],
      description: 'One short question, 5–180 characters, or null if nothing needs clarification.',
    },
    evidence: {
      type: 'object',
      additionalProperties: false,
      properties: {
        quantity: { type: ['string', 'null'] },
        budget: { type: ['string', 'null'] },
        delivery: { type: ['string', 'null'] },
        deadline: { type: ['string', 'null'] },
        constraints: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['quantity', 'budget', 'delivery', 'deadline', 'constraints'],
      description: 'Short exact excerpts from the request (at most 100 characters each, delivery at most 140); null for unstated details. At most four constraint excerpts.',
    },
  },
  required: [
    'shoppingMode', 'productQuery', 'unsupportedRequirements',
    'requestTitle',
    'quantity',
    'budgetKind',
    'budgetInr',
    'deliveryLocations',
    'deadline',
    'hardConstraints',
    'missingFields',
    'clarifyingQuestion',
    'evidence',
  ],
} as const;

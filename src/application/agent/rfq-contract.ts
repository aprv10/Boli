import { z } from 'zod';

export const hardConstraintSchema = z.enum([
  'vegan',
  'plastic-free',
  'branded',
  'multi-city',
]);

export const rfqInterpretationSchema = z.object({
  requestTitle: z.string().trim().min(3).max(80),
  quantity: z.number().int().min(10).max(10_000).nullable(),
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

export const RFQ_INTERPRETATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requestTitle: { type: 'string', minLength: 3, maxLength: 80 },
    quantity: { anyOf: [{ type: 'integer', minimum: 10, maximum: 10_000 }, { type: 'null' }] },
    budgetKind: { type: 'string', enum: ['per_unit', 'total', 'unknown'] },
    budgetInr: { anyOf: [{ type: 'number', minimum: 1, maximum: 10_000_000 }, { type: 'null' }] },
    deliveryLocations: {
      type: 'array',
      maxItems: 10,
      items: { type: 'string', minLength: 2, maxLength: 80 },
    },
    deadline: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    hardConstraints: {
      type: 'array',
      maxItems: 4,
      uniqueItems: true,
      items: {
        type: 'string',
        enum: ['vegan', 'plastic-free', 'branded', 'multi-city'],
      },
    },
    missingFields: {
      type: 'array',
      maxItems: 4,
      uniqueItems: true,
      items: {
        type: 'string',
        enum: ['quantity', 'budget_per_kit', 'delivery_locations', 'deadline'],
      },
    },
    clarifyingQuestion: {
      anyOf: [{ type: 'string', minLength: 5, maxLength: 180 }, { type: 'null' }],
    },
    evidence: {
      type: 'object',
      additionalProperties: false,
      properties: {
        quantity: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
        budget: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
        delivery: { anyOf: [{ type: 'string', maxLength: 140 }, { type: 'null' }] },
        deadline: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
        constraints: {
          type: 'array',
          maxItems: 4,
          items: { type: 'string', maxLength: 100 },
        },
      },
      required: ['quantity', 'budget', 'delivery', 'deadline', 'constraints'],
    },
  },
  required: [
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

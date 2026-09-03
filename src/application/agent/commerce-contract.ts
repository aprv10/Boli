import { z } from 'zod';
import { purchaseIntentInput } from '../purchase-contract';

export const quoteHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const optionKeySchema = z.enum(['best-value', 'balanced', 'premium-under-cap']);
export const agentToolRequest = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('describe_merchant'), input: z.object({}).optional() }),
  z.object({ tool: z.literal('submit_purchase_intent'), input: purchaseIntentInput }),
  z.object({ tool: z.enum(['get_deal_options', 'get_deal_status', 'get_audit_receipt', 'get_upsell']), input: z.object({ dealId: z.uuid() }) }),
  z.object({ tool: z.literal('select_option'), input: z.object({ dealId: z.uuid(), optionKey: optionKeySchema }) }),
  z.object({ tool: z.literal('submit_counteroffer'), input: z.object({
    dealId: z.uuid(), expectedQuoteHash: quoteHashSchema, targetUnitPaise: z.number().int().min(100).max(10_000_000),
    buyerMessage: z.string().trim().min(3).max(280), allowAlternatives: z.boolean().default(false),
  }) }),
  z.object({ tool: z.literal('choose_counteroffer'), input: z.object({
    dealId: z.uuid(), counterofferId: z.uuid(), expectedQuoteHash: quoteHashSchema, choice: z.enum(['original', 'revised']),
  }) }),
  z.object({ tool: z.literal('accept_upsell'), input: z.object({
    dealId: z.uuid(), expectedQuoteHash: quoteHashSchema, productId: z.string().trim().min(1).max(120),
    expectedUnitPricePaise: z.number().int().min(1).max(10_000_000), buyerApproved: z.literal(true),
  }) }),
  z.object({ tool: z.literal('accept_quote'), input: z.object({ dealId: z.uuid(), expectedQuoteHash: quoteHashSchema, buyerApproved: z.literal(true) }) }),
  z.object({ tool: z.literal('create_checkout'), input: z.object({ dealId: z.uuid(), expectedQuoteHash: quoteHashSchema, idempotencyKey: z.uuid() }) }),
]);

export const agentRunRequest = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('start'), mandate: purchaseIntentInput }),
  z.object({ mode: z.literal('resume'), dealId: z.uuid() }),
  z.object({ mode: z.literal('accept'), dealId: z.uuid(), expectedQuoteHash: quoteHashSchema, buyerApproved: z.literal(true) }),
]);

export type AgentStep = { tool: string; status: 'completed' | 'waiting' | 'blocked'; title: string; summary: string };

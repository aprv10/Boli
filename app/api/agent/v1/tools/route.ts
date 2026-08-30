import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { authorizeAgentRequest } from '@/src/application/agent/agent-access';
import {
  acceptAgentQuote,
  createAgentCheckout,
  describeMerchantForAgent,
  getAgentAuditReceipt,
  getAgentDealSnapshot,
  submitAgentCounteroffer,
  submitAgentPurchaseIntent,
} from '@/src/application/agent/commerce-tools';
import { hardConstraintSchema } from '@/src/application/agent/rfq-contract';
import { QuoteWorkflowError } from '@/src/application/quote-workflow';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('describe_merchant'), input: z.object({}).optional() }),
  z.object({
    tool: z.literal('submit_purchase_intent'),
    input: z.object({
      rawText: z.string().trim().min(40).max(600),
      hardConstraints: z.array(hardConstraintSchema).max(4),
      quantity: z.number().int().min(10).max(10_000),
      maxUnitPaise: z.number().int().min(10_000).max(10_000_000),
      deliveryLocations: z.array(z.string().trim().min(2).max(80)).min(1).max(10),
      deadline: z.iso.date(),
    }),
  }),
  z.object({
    tool: z.enum(['get_deal_options', 'get_deal_status', 'get_audit_receipt']),
    input: z.object({ dealId: z.uuid() }),
  }),
  z.object({
    tool: z.literal('submit_counteroffer'),
    input: z.object({
      dealId: z.uuid(),
      expectedQuoteHash: hashSchema,
      targetUnitPaise: z.number().int().min(10_000).max(10_000_000),
      buyerMessage: z.string().trim().min(8).max(280),
    }),
  }),
  z.object({
    tool: z.literal('accept_quote'),
    input: z.object({ dealId: z.uuid(), expectedQuoteHash: hashSchema }),
  }),
  z.object({
    tool: z.literal('create_checkout'),
    input: z.object({
      dealId: z.uuid(),
      expectedQuoteHash: hashSchema,
      idempotencyKey: z.uuid(),
    }),
  }),
]);

function toolResponse(tool: string, result: unknown, authority: string, nextAction: string | null) {
  return Response.json({ ok: true, tool, authority, result, nextAction });
}

export async function POST(request: Request) {
  if (!(await authorizeAgentRequest(request))) {
    return Response.json(
      { error: { code: 'AGENT_UNAUTHORIZED', message: 'Agent credentials are missing or invalid.' } },
      { status: 401 },
    );
  }
  await ensureDatabase(env.DB);
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'INVALID_TOOL_INPUT', message: 'The tool call does not match its contract.' } },
      { status: 400 },
    );
  }

  try {
    const call = parsed.data;
    switch (call.tool) {
      case 'describe_merchant':
        return toolResponse(call.tool, await describeMerchantForAgent(env.DB), 'READ_ONLY', null);
      case 'submit_purchase_intent':
        return toolResponse(
          call.tool,
          await submitAgentPurchaseIntent(env.DB, call.input),
          'BUYER_MANDATE_RECORDED',
          'get_deal_options',
        );
      case 'get_deal_options':
      case 'get_deal_status':
        return toolResponse(
          call.tool,
          await getAgentDealSnapshot(env.DB, call.input.dealId),
          'READ_ONLY',
          null,
        );
      case 'get_audit_receipt':
        return toolResponse(
          call.tool,
          await getAgentAuditReceipt(env.DB, call.input.dealId),
          'READ_ONLY',
          null,
        );
      case 'submit_counteroffer': {
        const result = await submitAgentCounteroffer(env.DB, call.input.dealId, call.input);
        return toolResponse(
          call.tool,
          {
            counteroffer: {
              id: result.counteroffer.id,
              status: result.counteroffer.status,
              targetUnitPaise: result.counteroffer.targetUnitPaise,
              proposedUnitPaise: result.counteroffer.proposedOption?.unitTotalPaise ?? null,
              checks: result.counteroffer.checks,
              reasonCodes: result.counteroffer.reasonCodes,
              summary: result.counteroffer.decisionSummary,
            },
            quote: result.quote
              ? {
                  version: result.quote.version,
                  quoteHash: result.quote.quoteHash,
                  unitTotalPaise: result.quote.unitTotalPaise,
                  status: result.quote.status,
                }
              : null,
          },
          result.counteroffer.status === 'merchant_approval_required'
            ? 'HUMAN_APPROVAL_REQUIRED'
            : 'MERCHANT_POLICY_EVALUATED',
          'get_deal_status',
        );
      }
      case 'accept_quote': {
        const result = await acceptAgentQuote(env.DB, call.input.dealId, call.input.expectedQuoteHash);
        return toolResponse(
          call.tool,
          {
            quote: {
              id: result.quote.id,
              version: result.quote.version,
              quoteHash: result.quote.quoteHash,
              unitTotalPaise: result.quote.unitTotalPaise,
              orderTotalPaise: result.quote.orderTotalPaise,
              status: result.quote.status,
              acceptedAt: result.quote.acceptedAt,
            },
            alreadyAccepted: result.alreadyAccepted,
            dealRoomPath: result.dealRoomPath,
          },
          'EXACT_QUOTE_HASH_AND_BUYER_MANDATE_VERIFIED',
          'create_checkout',
        );
      }
      case 'create_checkout': {
        const result = await createAgentCheckout(
          env.DB,
          call.input.dealId,
          call.input.expectedQuoteHash,
          call.input.idempotencyKey,
        );
        return toolResponse(
          call.tool,
          result,
          'SEPARATE_MONEY_GATE_AND_INVENTORY_RECHECKED',
          result.nextAction,
        );
      }
    }
  } catch (error) {
    if (error instanceof QuoteWorkflowError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }
}

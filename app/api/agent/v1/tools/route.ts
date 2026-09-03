import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { authorizeAgentRequest } from '@/src/application/agent/agent-access';
import {
  acceptAgentQuote, acceptAgentUpsell, chooseAgentCounteroffer, createAgentCheckout,
  describeMerchantForAgent, getAgentAuditReceipt, getAgentDealSnapshot, getAgentUpsell,
  selectAgentOption, submitAgentCounteroffer, submitAgentPurchaseIntent,
} from '@/src/application/agent/commerce-tools';
import { agentToolRequest } from '@/src/application/agent/commerce-contract';
import { QuoteWorkflowError } from '@/src/application/quote-workflow';

function toolResponse(tool: string, result: unknown, authority: string, nextAction: string | null) {
  return Response.json({ ok: true, tool, authority, result, nextAction });
}

export async function POST(request: Request) {
  if (!(await authorizeAgentRequest(request))) {
    return Response.json({ error: { code: 'AGENT_UNAUTHORIZED', message: 'Agent credentials are missing or invalid.' } }, { status: 401 });
  }
  const parsed = agentToolRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: 'INVALID_TOOL_INPUT', message: 'The tool call does not match its contract.' } }, { status: 400 });
  }
  await ensureDatabase(env.DB);
  const apiKey = env.MISTRAL_API_KEY ?? process.env.MISTRAL_API_KEY;
  try {
    const call = parsed.data;
    switch (call.tool) {
      case 'describe_merchant':
        return toolResponse(call.tool, await describeMerchantForAgent(env.DB), 'READ_ONLY', null);
      case 'submit_purchase_intent':
        return toolResponse(call.tool, await submitAgentPurchaseIntent(env.DB, call.input), 'BUYER_MANDATE_RECORDED', 'get_deal_options');
      case 'get_deal_options':
      case 'get_deal_status': {
        const result = await getAgentDealSnapshot(env.DB, call.input.dealId, { rankOptions: call.tool === 'get_deal_options', apiKey });
        return toolResponse(call.tool, result, call.tool === 'get_deal_options' ? 'ADVISORY_RANKING_ONLY' : 'READ_ONLY',
          result.deal.stage === 'ready_to_select' ? 'select_option' : result.deal.stage === 'ready_to_accept' ? 'REVIEW_EXACT_QUOTE' : null);
      }
      case 'get_audit_receipt':
        return toolResponse(call.tool, await getAgentAuditReceipt(env.DB, call.input.dealId), 'READ_ONLY', null);
      case 'select_option':
        return toolResponse(call.tool, await selectAgentOption(env.DB, call.input.dealId, call.input.optionKey),
          'BACKEND_QUOTE_AUTHORIZED_UNDER_MERCHANT_POLICY', 'REVIEW_EXACT_QUOTE');
      case 'submit_counteroffer': {
        const result = await submitAgentCounteroffer(env.DB, call.input.dealId, call.input);
        return toolResponse(call.tool, {
          counteroffer: {
            id: result.counteroffer.id, status: result.counteroffer.status, buyerChoice: result.counteroffer.buyerChoice,
            targetUnitPaise: result.counteroffer.targetUnitPaise,
            proposedUnitPaise: result.counteroffer.proposedOption?.unitTotalPaise ?? null,
            lines: result.counteroffer.proposedOption?.lines.map(({ code, label, kind, unitPricePaise, productId }) => ({ code, label, kind, unitPricePaise, productId })) ?? [],
            checks: result.counteroffer.checks, reasonCodes: result.counteroffer.reasonCodes, summary: result.counteroffer.decisionSummary,
          },
          quoteUnchanged: true,
        }, result.counteroffer.status === 'merchant_approval_required' ? 'HUMAN_APPROVAL_REQUIRED' : 'MERCHANT_POLICY_EVALUATED',
          result.counteroffer.status === 'merchant_approval_required' ? 'get_deal_status' : result.counteroffer.buyerChoice === 'pending' ? 'choose_counteroffer' : 'REVIEW_EXACT_QUOTE');
      }
      case 'choose_counteroffer':
        return toolResponse(call.tool, await chooseAgentCounteroffer(env.DB, call.input.dealId, call.input), 'BUYER_OFFER_CHOICE_RECORDED', 'REVIEW_EXACT_QUOTE');
      case 'get_upsell':
        return toolResponse(call.tool, await getAgentUpsell(env.DB, call.input.dealId, apiKey), 'ADVISORY_SELECTION_ONLY', 'BUYER_APPROVAL_REQUIRED_FOR_ADD_ON');
      case 'accept_upsell':
        return toolResponse(call.tool, await acceptAgentUpsell(env.DB, call.input.dealId, call.input), 'EXACT_ADD_ON_RECHECKED_BY_BACKEND', 'REVIEW_EXACT_QUOTE');
      case 'accept_quote': {
        const result = await acceptAgentQuote(env.DB, call.input.dealId, call.input.expectedQuoteHash);
        return toolResponse(call.tool, {
          quote: { id: result.quote.id, version: result.quote.version, quoteHash: result.quote.quoteHash,
            unitTotalPaise: result.quote.unitTotalPaise, orderTotalPaise: result.quote.orderTotalPaise,
            status: result.quote.status, acceptedAt: result.quote.acceptedAt },
          alreadyAccepted: result.alreadyAccepted, dealRoomPath: result.dealRoomPath,
        }, 'EXACT_QUOTE_HASH_AND_BUYER_MANDATE_VERIFIED', 'create_checkout');
      }
      case 'create_checkout': {
        const result = await createAgentCheckout(env.DB, call.input.dealId, call.input.expectedQuoteHash, call.input.idempotencyKey);
        return toolResponse(call.tool, result, 'SEPARATE_MONEY_GATE_AND_INVENTORY_RECHECKED', result.nextAction);
      }
    }
  } catch (error) {
    if (error instanceof QuoteWorkflowError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    if (error instanceof Error && error.message === 'INVALID_AGENT_TRACE') {
      return Response.json({ error: { code: 'INVALID_AGENT_TRACE', message: 'Re-read the request or submit a manually reviewed mandate.' } }, { status: 400 });
    }
    if (/constraint|unique/i.test(String(error))) {
      return Response.json({ error: { code: 'COMMERCE_STATE_CHANGED', message: 'The order, stock or policy changed. Read the current deal before retrying.' } }, { status: 409 });
    }
    return Response.json({ error: { code: 'TOOL_UNAVAILABLE', message: 'The action could not be confirmed. Read the deal status before retrying.' } }, { status: 500 });
  }
}

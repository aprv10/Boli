import type { z } from 'zod';
import type { agentRunRequest, AgentStep } from './commerce-contract';
import {
  acceptAgentQuote, describeMerchantForAgent, getAgentAuditReceipt, getAgentDealSnapshot,
  selectAgentOption, submitAgentPurchaseIntent,
} from './commerce-tools';
import { QuoteWorkflowError } from '../quote-workflow';

const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);

/** A single bounded orchestrator. No payment tool or automatic quote acceptance. */
export async function runGuidedBuyer(binding: D1Database, input: z.infer<typeof agentRunRequest>, apiKey?: string) {
  const steps: AgentStep[] = [];
  let dealId: string;
  if (input.mode === 'start') {
    const merchant = await describeMerchantForAgent(binding);
    steps.push({ tool: 'describe_merchant', status: 'completed', title: 'Store connected',
      summary: `${merchant.merchant.name}: ${merchant.catalog.length} active products, with availability net of existing reservations.` });
    const deal = await submitAgentPurchaseIntent(binding, input.mandate);
    dealId = deal.id;
    steps.push({ tool: 'submit_purchase_intent', status: 'completed', title: 'Reviewed request saved',
      summary: `${input.mandate.quantity} ${input.mandate.selection?.mode === 'product' ? 'items' : 'kits'}, up to ${money(input.mandate.maxUnitPaise)} each. Custom requirements were preserved.` });
  } else {
    dealId = input.dealId;
  }
  let snapshot = await getAgentDealSnapshot(binding, dealId, { rankOptions: input.mode === 'start', apiKey });
  if (input.mode !== 'start') steps.push({ tool: 'get_deal_status', status: 'completed', title: 'Order refreshed',
    summary: 'Read the current quote, merchant response, negotiation and payment state.' });
  let recommendation = snapshot.options.find(option => option.recommended) ?? snapshot.options[0] ?? null;
  if (input.mode !== 'accept' && snapshot.deal.stage === 'ready_to_select') {
    if (input.mode !== 'start') {
      snapshot = await getAgentDealSnapshot(binding, dealId, { rankOptions: true, apiKey });
      recommendation = snapshot.options.find(option => option.recommended) ?? snapshot.options[0] ?? null;
    }
    if (recommendation) {
      steps.push({ tool: 'get_deal_options', status: 'completed', title: 'Eligible options compared',
        summary: `${snapshot.options.length} distinct options passed backend checks. ${recommendation.recommendationSource === 'mistral' ? 'Mistral recommended' : 'The backend recommended'} ${recommendation.label} at ${money(recommendation.unitTotalPaise)} per unit.` });
      try {
        const selected = await selectAgentOption(binding, dealId, recommendation.key);
        steps.push({ tool: 'select_option', status: 'completed', title: 'Offer authorized by store rules',
          summary: `Backend quote v${selected.quote.version}: ${money(selected.quote.orderTotalPaise)} total. The product, stock, budget and margin checks passed. No payment was requested.` });
      } catch (error) {
        steps.push({ tool: 'select_option', status: 'blocked', title: 'Offer needs a fresh check',
          summary: error instanceof QuoteWorkflowError ? error.message : 'The offer could not be confirmed. Refresh the result before continuing; no payment was requested.' });
      }
      snapshot = await getAgentDealSnapshot(binding, dealId);
    }
  }
  if (input.mode === 'accept') {
    // This mode is only exposed behind an explicit button and exact displayed hash.
    await acceptAgentQuote(binding, dealId, input.expectedQuoteHash);
    steps.push({ tool: 'accept_quote', status: 'completed', title: 'Buyer approved the exact offer',
      summary: 'The backend checked the displayed quote hash and buyer mandate. Checkout and payment remain separate.' });
    snapshot = await getAgentDealSnapshot(binding, dealId);
  }

  const stage = snapshot.deal.stage;
  const instruction = stage === 'awaiting_merchant_approval'
    ? snapshot.negotiation?.awaitingBuyerChoice ? 'The requested discount needs a store decision. You can keep the original offer in your order.'
      : 'The store needs to confirm your specific request. Open store review, then refresh this result.'
    : stage === 'requirements_need_changes' ? 'Read the store’s response and start a revised request.'
    : stage === 'request_declined' ? 'The store declined this request. You can start a different request.'
    : stage === 'not_fulfillable' ? snapshot.rejectionReasons.map(reason => reason.message).join(' ') || 'No catalog options satisfy this request.'
    : stage === 'quote_expired' ? 'The quote expired. Start a new request for current prices and availability.'
    : stage === 'counteroffer_choice_required' ? 'Choose the revised or original offer in your order before continuing.'
    : stage === 'ready_to_accept' ? 'Review the exact items and total. You can negotiate or consider an add-on in your order before approving.'
    : stage === 'ready_to_select' ? 'Refresh to check the available options again.'
    : stage === 'accepted' ? 'Your offer is accepted. Open the order to start checkout; no payment has been confirmed yet.'
    : 'Open your order for the current payment or recovery status.';
  steps.push({ tool: 'buyer_review',
    status: ['requirements_need_changes', 'request_declined', 'not_fulfillable', 'quote_expired'].includes(stage) ? 'blocked' : 'waiting',
    title: stage === 'ready_to_accept' ? 'Ready for buyer approval'
      : stage === 'awaiting_merchant_approval' ? 'Store confirmation required'
      : stage === 'accepted' ? 'Ready for separate checkout' : 'Next action', summary: instruction });
  const audit = await getAgentAuditReceipt(binding, dealId);
  steps.push({ tool: 'get_audit_receipt', status: audit.verified ? 'completed' : 'blocked',
    title: audit.verified ? 'Recorded decision chain verified' : 'Audit verification warning',
    summary: `${audit.events.length} saved events checked. This verifies the stored chain, not an externally anchored history.` });
  return { runId: dealId, stage, deal: snapshot.deal, quote: snapshot.currentQuote,
    customRequest: snapshot.customRequest, negotiation: snapshot.negotiation,
    recommendedOption: recommendation, steps, instruction, audit: { verified: audit.verified, headHash: audit.headHash } };
}

export type GuidedBuyerRun = Awaited<ReturnType<typeof runGuidedBuyer>>;

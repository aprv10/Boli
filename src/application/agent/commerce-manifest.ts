import { agentAccessMode } from './agent-access';
import { z } from 'zod';
import { agentToolRequest } from './commerce-contract';

export function commerceManifest(origin: string) {
  return {
    schema: 'https://boli.local/schemas/agentic-commerce-manifest.v1.json',
    name: 'Boli Agentic Commerce',
    description: 'Buy catalog products or welcome kits through the same quote, policy and checkout workflows as a human buyer.',
    merchantDiscovery: `${origin}/api/agent/v1/merchant`,
    toolEndpoint: `${origin}/api/agent/v1/tools`,
    authentication: { mode: agentAccessMode(), header: 'Authorization: Bearer <token>' },
    currency: 'INR',
    moneyFormat: 'integer_paise',
    toolRequestSchema: z.toJSONSchema(agentToolRequest, { io: 'input' }),
    requestNotes: [
      'Use selection.mode=product with a product query, or selection.mode=kit for welcome kits.',
      'maxUnitPaise is the all-in maximum per item or kit. For a whole-order budget, divide integer paise by quantity and round down.',
      'Put requirements outside the supported constraint list in customRequirements. Required ones pause for merchant confirmation.',
      'A deadline must be today or later. Multi-city requires at least two distinct cities; these rules are checked at runtime.',
      'buyerApproved=true is an explicit confirmation from the calling buyer. It must never be inferred from model recommendation text.',
    ],
    tools: [
      { name: 'describe_merchant', mutates: false, approval: 'none' },
      { name: 'submit_purchase_intent', mutates: true, approval: 'buyer_mandate' },
      { name: 'get_deal_options', mutates: true, effect: 'advisory_audit_only', approval: 'none' },
      { name: 'select_option', mutates: true, approval: 'deterministic_merchant_policy', description: 'Issue an exact backend quote for an eligible option. Does not accept or purchase it.' },
      { name: 'submit_counteroffer', mutates: true, approval: 'bounded_by_policy' },
      { name: 'choose_counteroffer', mutates: true, approval: 'explicit_original_or_revised_choice' },
      { name: 'get_upsell', mutates: true, effect: 'advisory_audit_only', approval: 'none' },
      { name: 'accept_upsell', mutates: true, approval: 'buyer_confirmation_of_exact_item_and_price' },
      { name: 'accept_quote', mutates: true, approval: 'buyer_confirmation_and_exact_quote_hash' },
      { name: 'get_deal_status', mutates: false, approval: 'none' },
      { name: 'get_audit_receipt', mutates: false, approval: 'none' },
      { name: 'create_checkout', mutates: true, approval: 'separate_money_gate', available: true },
    ],
    guarantees: [
      'Hard constraints are never silently relaxed.',
      'The buyer budget and merchant policy are rechecked before acceptance.',
      'Commercial decisions and completed transaction state changes are recorded in the hash-linked audit ledger.',
      'Checkout cannot be created by quote acceptance alone.',
      'Only a verified captured-payment webhook can mark an order paid.',
      'Refund requests are amount-bounded and idempotent.',
    ],
  };
}

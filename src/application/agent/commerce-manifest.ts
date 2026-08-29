import { agentAccessMode } from './agent-access';

export function commerceManifest(origin: string) {
  return {
    schema: 'https://boli.local/schemas/agentic-commerce-manifest.v1.json',
    name: 'Boli Agentic Commerce',
    description: 'Bounded quote-to-order commerce for configurable bulk purchases.',
    merchantDiscovery: `${origin}/api/agent/v1/merchant`,
    toolEndpoint: `${origin}/api/agent/v1/tools`,
    authentication: { mode: agentAccessMode(), header: 'Authorization: Bearer <token>' },
    currency: 'INR',
    moneyFormat: 'integer_paise',
    tools: [
      { name: 'describe_merchant', mutates: false, approval: 'none' },
      { name: 'submit_purchase_intent', mutates: true, approval: 'buyer_mandate' },
      { name: 'get_deal_options', mutates: false, approval: 'none' },
      { name: 'submit_counteroffer', mutates: true, approval: 'bounded_by_policy' },
      { name: 'accept_quote', mutates: true, approval: 'exact_quote_hash' },
      { name: 'get_deal_status', mutates: false, approval: 'none' },
      { name: 'get_audit_receipt', mutates: false, approval: 'none' },
      { name: 'create_checkout', mutates: true, approval: 'separate_money_gate', available: false },
    ],
    guarantees: [
      'Hard constraints are never silently relaxed.',
      'The buyer budget and merchant policy are rechecked before acceptance.',
      'Every state-changing action is appended to a hash-linked audit ledger.',
      'Checkout cannot be created by quote acceptance alone.',
    ],
  };
}

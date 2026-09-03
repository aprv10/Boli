import { describe, expect, it } from 'vitest';
import { agentRunRequest, agentToolRequest } from './commerce-contract';
import { purchaseIntentInput } from '../purchase-contract';
import { authorizeLocalAgentConsole } from './agent-access';

const dealId = '27b2ae70-8f6a-4a81-b241-f50b25491bf1';
const hash = 'a'.repeat(64);
const mandate = { rawText: 'One steel bottle please', selection: { mode: 'product', query: 'steel bottle' },
  hardConstraints: [], customRequirements: [{ text: 'Engrave the name Apoorv', priority: 'required' }],
  quantity: 1, maxUnitPaise: 40000, deliveryLocations: ['Chennai'], deadline: '2099-09-24' };

describe('shared buyer / agent mandate', () => {
  it('accepts the same single-product and custom-requirement input in all entry points', () => {
    const human = purchaseIntentInput.parse(mandate);
    const agent = agentToolRequest.parse({ tool: 'submit_purchase_intent', input: mandate });
    const guided = agentRunRequest.parse({ mode: 'start', mandate });
    if (agent.tool !== 'submit_purchase_intent' || guided.mode !== 'start') throw new Error('Unexpected contract');
    expect(agent.input).toEqual(human);
    expect(guided.mandate).toEqual(human);
    expect(agent.input.customRequirements).toEqual(mandate.customRequirements);
  });

  it.each([
    { quantity: 0 }, { maxUnitPaise: 99 }, { deadline: '2020-01-01' },
    { hardConstraints: ['multi-city'], deliveryLocations: ['Chennai', ' chennai '] },
    { selection: { mode: 'product', query: '' } }, { unsupportedRequirements: ['must not discard this'] },
    { agentRunId: dealId },
  ])('rejects the same invalid mandate across human and agent boundaries: %j', change => {
    const input = { ...mandate, ...change };
    expect(purchaseIntentInput.safeParse(input).success).toBe(false);
    expect(agentToolRequest.safeParse({ tool: 'submit_purchase_intent', input }).success).toBe(false);
    expect(agentRunRequest.safeParse({ mode: 'start', mandate: input }).success).toBe(false);
  });

  it('supports all backend option keys and keeps product swaps opt-in', () => {
    for (const optionKey of ['best-value', 'balanced', 'premium-under-cap']) {
      expect(agentToolRequest.safeParse({ tool: 'select_option', input: { dealId, optionKey } }).success).toBe(true);
    }
    const call = agentToolRequest.parse({ tool: 'submit_counteroffer', input: {
      dealId, expectedQuoteHash: hash, targetUnitPaise: 850, buyerMessage: '₹8.50 each',
    } });
    if (call.tool !== 'submit_counteroffer') throw new Error('Unexpected tool');
    expect(call.input.allowAlternatives).toBe(false);
  });

  it('requires exact quote / product expectations and explicit approval for acceptance', () => {
    expect(agentRunRequest.safeParse({ mode: 'accept', dealId, expectedQuoteHash: hash }).success).toBe(false);
    expect(agentRunRequest.safeParse({ mode: 'accept', dealId, expectedQuoteHash: hash, buyerApproved: true }).success).toBe(true);
    expect(agentToolRequest.safeParse({ tool: 'accept_quote', input: { dealId, expectedQuoteHash: hash } }).success).toBe(false);
    expect(agentToolRequest.safeParse({ tool: 'accept_upsell', input: { dealId, expectedQuoteHash: hash, buyerApproved: true } }).success).toBe(false);
    expect(agentToolRequest.safeParse({ tool: 'accept_upsell', input: { dealId, expectedQuoteHash: hash, buyerApproved: true, productId: 'prod-desk-plant', expectedUnitPricePaise: 15500 } }).success).toBe(true);
  });

  it('allows only same-origin local guided-console requests, including IPv6', () => {
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      expect(authorizeLocalAgentConsole(new Request(`${origin}/api/agent/v1/run`, { headers: { origin } }))).toBe(true);
      expect(authorizeLocalAgentConsole(new Request(`${origin}/api/agent/v1/run`, { headers: { origin: 'https://untrusted.example' } }))).toBe(false);
    }
    expect(authorizeLocalAgentConsole(new Request('http://localhost:3000/api/agent/v1/run'))).toBe(false);
    expect(authorizeLocalAgentConsole(new Request('https://boli.example/api/agent/v1/run', { headers: { origin: 'https://boli.example' } }))).toBe(false);
  });
});

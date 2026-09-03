import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runGuidedBuyer } from './guided-buyer';
import {
  acceptAgentQuote, createAgentCheckout, describeMerchantForAgent, getAgentAuditReceipt, getAgentDealSnapshot,
  selectAgentOption, submitAgentPurchaseIntent,
} from './commerce-tools';

vi.mock('./commerce-tools', () => ({ acceptAgentQuote: vi.fn(), createAgentCheckout: vi.fn(),
  describeMerchantForAgent: vi.fn(), getAgentAuditReceipt: vi.fn(), getAgentDealSnapshot: vi.fn(), selectAgentOption: vi.fn(), submitAgentPurchaseIntent: vi.fn() }));

type Snapshot = Awaited<ReturnType<typeof getAgentDealSnapshot>>;
const binding = {} as D1Database;
const dealId = '27b2ae70-8f6a-4a81-b241-f50b25491bf1';
const mandate = { rawText: '30 welcome kits for Chennai', selection: { mode: 'kit' as const, query: '' },
  quantity: 30, maxUnitPaise: 90000, hardConstraints: [], deliveryLocations: ['Chennai'], deadline: '2099-09-24' };
const quote: NonNullable<Snapshot['currentQuote']> = { id: 'quote', version: 1, label: 'Fastest', unitTotalPaise: 85000, orderTotalPaise: 2550000,
  quoteHash: 'a'.repeat(64), policyVersion: 1, expiresAt: '2099-09-05T00:00:00Z', status: 'merchant_approved', checks: [], lines: [] };
function snapshot(stage: Snapshot['deal']['stage']): Snapshot {
  return { deal: { id: dealId, publicToken: 'token', stage, dealRoomPath: '/deal/token', mandate: { ...mandate, customRequirements: [] } },
    customRequest: null, negotiation: null, currentQuote: null, rejectionReasons: [],
    options: [{ key: 'best-value', label: 'Cheapest', recommended: false, recommendationSource: 'mistral', rationale: '', unitTotalPaise: 80000, orderTotalPaise: 2400000, headroomPaise: 10000, deliveryDays: 5, lines: [], checks: [] },
      { key: 'premium-under-cap', label: 'Fastest', recommended: true, recommendationSource: 'mistral', rationale: '', unitTotalPaise: 85000, orderTotalPaise: 2550000, headroomPaise: 5000, deliveryDays: 2, lines: [], checks: [] }],
    payment: { stage: 'not_ready', order: null, providerPaymentId: null, refund: null } };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(describeMerchantForAgent).mockResolvedValue({ merchant: { name: 'The Good Batch' }, catalog: [] } as unknown as Awaited<ReturnType<typeof describeMerchantForAgent>>);
  vi.mocked(submitAgentPurchaseIntent).mockResolvedValue({ id: dealId, intentId: 'intent', publicToken: 'token', state: 'intent_received', createdAt: '', dealRoomPath: '/deal/token' });
  vi.mocked(selectAgentOption).mockResolvedValue({ quote, dealRoomPath: '/deal/token', reused: false });
  vi.mocked(getAgentAuditReceipt).mockResolvedValue({ dealId, stage: 'ready_to_accept', verified: true, headHash: 'b'.repeat(64), events: [] });
});

describe('guided agent orchestration', () => {
  it('selects the recommended option through backend policy without accepting or creating checkout', async () => {
    vi.mocked(getAgentDealSnapshot).mockResolvedValueOnce(snapshot('ready_to_select'))
      .mockResolvedValueOnce({ ...snapshot('ready_to_accept'), currentQuote: quote });
    const result = await runGuidedBuyer(binding, { mode: 'start', mandate }, 'key');
    expect(selectAgentOption).toHaveBeenCalledWith(binding, dealId, 'premium-under-cap');
    expect(submitAgentPurchaseIntent).toHaveBeenCalledWith(binding, mandate);
    expect(result.stage).toBe('ready_to_accept');
    expect(result.quote?.quoteHash).toBe(quote.quoteHash);
    expect(result.steps.some(step => step.tool === 'select_option' && step.status === 'completed')).toBe(true);
    expect(acceptAgentQuote).not.toHaveBeenCalled();
    expect(createAgentCheckout).not.toHaveBeenCalled();
  });

  it('keeps refresh separate from buyer acceptance', async () => {
    vi.mocked(getAgentDealSnapshot).mockResolvedValue({ ...snapshot('ready_to_accept'), currentQuote: quote });
    const result = await runGuidedBuyer(binding, { mode: 'resume', dealId }, 'key');
    expect(result.stage).toBe('ready_to_accept');
    expect(getAgentDealSnapshot).toHaveBeenCalledWith(binding, dealId, { rankOptions: false, apiKey: 'key' });
    expect(selectAgentOption).not.toHaveBeenCalled();
    expect(acceptAgentQuote).not.toHaveBeenCalled();
    expect(createAgentCheckout).not.toHaveBeenCalled();
  });

  it.each(['awaiting_merchant_approval', 'requirements_need_changes', 'request_declined', 'not_fulfillable', 'quote_expired', 'counteroffer_choice_required'] as const)(
    'respects the real %s state without issuing or accepting an offer', async stage => {
      vi.mocked(getAgentDealSnapshot).mockResolvedValue(snapshot(stage));
      const result = await runGuidedBuyer(binding, { mode: 'resume', dealId });
      expect(result.stage).toBe(stage);
      expect(selectAgentOption).not.toHaveBeenCalled(); expect(acceptAgentQuote).not.toHaveBeenCalled(); expect(createAgentCheckout).not.toHaveBeenCalled();
    });

  it('passes only the explicitly approved, displayed hash to acceptance; never starts checkout', async () => {
    vi.mocked(getAgentDealSnapshot).mockResolvedValueOnce({ ...snapshot('ready_to_accept'), currentQuote: quote })
      .mockResolvedValueOnce({ ...snapshot('accepted'), currentQuote: { ...quote, status: 'buyer_accepted' } });
    const result = await runGuidedBuyer(binding, { mode: 'accept', dealId, expectedQuoteHash: quote.quoteHash, buyerApproved: true });
    expect(acceptAgentQuote).toHaveBeenCalledWith(binding, dealId, quote.quoteHash);
    expect(result.stage).toBe('accepted');
    expect(createAgentCheckout).not.toHaveBeenCalled();
  });

  it('retains the request when quote authorization fails, instead of claiming success', async () => {
    vi.mocked(getAgentDealSnapshot).mockResolvedValue(snapshot('ready_to_select'));
    vi.mocked(selectAgentOption).mockRejectedValue(new Error('policy changed'));
    const result = await runGuidedBuyer(binding, { mode: 'start', mandate });
    expect(result.deal.id).toBe(dealId);
    expect(result.steps.find(step => step.tool === 'select_option')?.status).toBe('blocked');
    expect(result.quote).toBeNull();
    expect(acceptAgentQuote).not.toHaveBeenCalled(); expect(createAgentCheckout).not.toHaveBeenCalled();
  });
});

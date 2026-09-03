import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAgentDealSnapshot, selectAgentOption } from './commerce-tools';
import { approveQuoteOption, loadDealQuotes, loadDealQuoteWorkspace, type DealQuoteWorkspace, type StoredQuote } from '../quote-workflow';
import { loadCustomQuoteRequest } from '../custom-quote-workflow';
import { loadDealCounteroffers } from '../counteroffer-workflow';
import { loadDealPaymentState } from '../payment-workflow';
import { rankDealOptions } from '../recommendation-workflow';

vi.mock('../quote-workflow', async original => ({ ...await original<typeof import('../quote-workflow')>(),
  approveQuoteOption: vi.fn(), loadDealQuotes: vi.fn(), loadDealQuoteWorkspace: vi.fn() }));
vi.mock('../custom-quote-workflow', () => ({ loadCustomQuoteRequest: vi.fn() }));
vi.mock('../counteroffer-workflow', () => ({ loadDealCounteroffers: vi.fn(), chooseCounteroffer: vi.fn(), submitBoundedCounteroffer: vi.fn() }));
vi.mock('../payment-workflow', () => ({ loadDealPaymentState: vi.fn(), createCheckoutOrder: vi.fn() }));
vi.mock('../recommendation-workflow', () => ({ rankDealOptions: vi.fn() }));
const db = {} as D1Database;
const now = '2026-09-03T12:00:00Z';

function workspace(): DealQuoteWorkspace {
  return { evaluatedAt: now, deal: { id: 'deal', merchantId: 'merchant', intentId: 'intent', publicToken: 'token', createdAt: now,
    rawText: '30 steel bottles', selection: { mode: 'product', query: 'steel bottles' }, customRequirements: [], quantity: 30, maxUnitPaise: 40000,
    deadline: '2026-09-24', hardConstraints: [], deliveryLocations: ['Chennai'], agentInterpretation: null },
    policy: { version: 1, minimumMarginBps: 2200, maximumAutomaticConcessionBps: 200 }, catalog: [],
    result: { status: 'generated', evaluatedCombinations: 1, feasibleCombinations: 1, options: [{ key: 'best-value', label: 'Cheapest', rationale: '', recommended: true,
      unitTotalPaise: 35000, orderTotalPaise: 1050000, productUnitPaise: 30000, serviceUnitPaise: 5000,
      unitCostPaise: 20000, contributionMarginBps: 4285, headroomPaise: 5000, lines: [], checks: [] }] } };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadDealQuoteWorkspace).mockResolvedValue(workspace());
  vi.mocked(loadDealQuotes).mockResolvedValue([]);
  vi.mocked(loadCustomQuoteRequest).mockResolvedValue(null);
  vi.mocked(loadDealCounteroffers).mockResolvedValue([]);
  vi.mocked(loadDealPaymentState).mockResolvedValue({ stage: 'not_ready' } as Awaited<ReturnType<typeof loadDealPaymentState>>);
});

describe('agent backend parity', () => {
  it('ordinary valid requests are ready to select, not waiting for a merchant', async () => {
    const result = await getAgentDealSnapshot(db, 'deal');
    expect(result.deal.stage).toBe('ready_to_select');
    expect(result.deal.mandate.selection).toEqual({ mode: 'product', query: 'steel bottles' });
    expect(result.options).toHaveLength(1);
    expect(rankDealOptions).not.toHaveBeenCalled();
  });

  it('option requests use the same ranking service as the human buyer', async () => {
    const value = workspace();
    if (value.result.status !== 'generated') throw new Error('Expected candidates');
    vi.mocked(rankDealOptions).mockResolvedValue(value.result.options.map(option => ({ ...option, recommended: option.recommended ?? false, recommendationSource: 'mistral' })));
    const result = await getAgentDealSnapshot(db, 'deal', { rankOptions: true, apiKey: 'key' });
    expect(rankDealOptions).toHaveBeenCalledWith(db, value, 'key');
    expect(result.options[0].recommendationSource).toBe('mistral');
  });

  it('required custom requirements do not leak automatically executable options', async () => {
    const value = workspace(); value.deal.customRequirements = [{ text: 'Engrave each employee name', priority: 'required' }];
    vi.mocked(loadDealQuoteWorkspace).mockResolvedValue(value);
    const result = await getAgentDealSnapshot(db, 'deal', { rankOptions: true, apiKey: 'key' });
    expect(result.deal.stage).toBe('awaiting_merchant_approval');
    expect(result.deal.mandate.customRequirements).toEqual(value.deal.customRequirements);
    expect(result.options).toEqual([]);
    expect(rankDealOptions).not.toHaveBeenCalled();
  });

  it('exposes merchant-requested changes instead of another approval dead end', async () => {
    vi.mocked(loadCustomQuoteRequest).mockResolvedValue({ status: 'needs_changes', buyerNote: 'Specific request', merchantResponse: 'Please change the date.', createdAt: now, respondedAt: now });
    const result = await getAgentDealSnapshot(db, 'deal');
    expect(result.deal.stage).toBe('requirements_need_changes');
    expect(result.customRequest?.merchantResponse).toBe('Please change the date.');
    expect(result.options).toEqual([]);
  });

  it('never treats an expired offer as ready for acceptance', async () => {
    vi.mocked(loadDealQuotes).mockResolvedValue([{ id: 'quote', status: 'merchant_approved', expiresAt: now, lines: [], checks: [] } as unknown as StoredQuote]);
    expect((await getAgentDealSnapshot(db, 'deal')).deal.stage).toBe('quote_expired');
  });

  it('routes option selection through shared deterministic authorization', async () => {
    const stored = { id: 'quote', version: 1, quoteHash: 'a'.repeat(64), status: 'merchant_approved', checks: [] } as unknown as StoredQuote;
    vi.mocked(approveQuoteOption).mockResolvedValue({ quote: stored, publicToken: 'token', reused: false });
    await selectAgentOption(db, 'deal', 'best-value');
    expect(approveQuoteOption).toHaveBeenCalledWith(db, 'deal', 'best-value', expect.any(String), 'system');
  });

  it('does not bypass a store-review request during option selection', async () => {
    vi.mocked(loadCustomQuoteRequest).mockResolvedValue({ status: 'pending', buyerNote: 'Custom request', merchantResponse: null, createdAt: now, respondedAt: null });
    await expect(selectAgentOption(db, 'deal', 'best-value')).rejects.toMatchObject({ code: 'MERCHANT_REVIEW_REQUESTED' });
    expect(approveQuoteOption).not.toHaveBeenCalled();
  });
});

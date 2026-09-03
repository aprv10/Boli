import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { rankDealOptions } from '@/src/application/recommendation-workflow';
import {
  approveQuoteOption,
  loadDealQuoteWorkspace,
  QuoteWorkflowError,
} from '@/src/application/quote-workflow';

const inputSchema = z.object({
  optionKey: z.enum(['best-value', 'balanced', 'premium-under-cap']),
});

type RouteContext = { params: Promise<{ dealId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  await ensureDatabase(env.DB);
  const { dealId } = await params;
  const workspace = await loadDealQuoteWorkspace(env.DB, dealId);
  if (!workspace) {
    return Response.json(
      { error: { code: 'DEAL_NOT_FOUND', message: 'This buying request does not exist.' } },
      { status: 404 },
    );
  }
  if (workspace.result.status === 'rejected') {
    return Response.json({ options: [], rejectionReasons: workspace.result.reasons });
  }

  const rankedOptions = await rankDealOptions(env.DB, workspace, env.MISTRAL_API_KEY ?? process.env.MISTRAL_API_KEY);
  return Response.json({
    merchant: { name: 'The Good Batch', source: 'demo_catalog' },
    authority: 'DETERMINISTIC_POLICY_ENGINE',
    options: rankedOptions.map((option) => ({
      key: option.key,
      label: option.label,
      recommended: option.recommended ?? option.key === 'best-value',
      rationale: option.rationale,
      recommendationSource: option.recommendationSource,
      unitTotalPaise: option.unitTotalPaise,
      orderTotalPaise: option.orderTotalPaise,
      deliveryDays: Number(
        option.checks.find((check) => check.code === 'LEAD_TIME_FEASIBLE')?.observed.replace('d', '') ?? 0,
      ),
      satisfiedConstraints: workspace.deal.hardConstraints,
      products: option.lines
        .filter((line) => line.kind === 'product')
        .map((line) => line.label),
      lines: option.lines.map(({ code, label, kind, unitPricePaise, productId }) => ({ code, label, kind, unitPricePaise, productId })),
      checks: option.checks,
    })),
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  await ensureDatabase(env.DB);
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Choose a valid quote option.' } },
      { status: 400 },
    );
  }

  try {
    const { dealId } = await params;
    const result = await approveQuoteOption(env.DB, dealId, parsed.data.optionKey, new Date().toISOString(), 'system');
    return Response.json({
      quote: {
        id: result.quote.id,
        version: result.quote.version,
        quoteHash: result.quote.quoteHash,
        status: result.quote.status,
        unitTotalPaise: result.quote.unitTotalPaise,
        orderTotalPaise: result.quote.orderTotalPaise,
        expiresAt: result.quote.expiresAt,
      },
      dealRoomPath: `/deal/${result.publicToken}`,
      reused: result.reused,
    });
  } catch (error) {
    if (error instanceof QuoteWorkflowError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    if (/constraint|unique/i.test(String(error))) {
      return Response.json({ error: { code: 'OFFER_CHANGED', message: 'Products, rules or the order changed while this offer was being prepared. Refresh and review the latest options.' } }, { status: 409 });
    }
    return Response.json({ error: { code: 'OFFER_UNAVAILABLE', message: 'We could not confirm the offer. Refresh before trying again.' } }, { status: 500 });
  }
}

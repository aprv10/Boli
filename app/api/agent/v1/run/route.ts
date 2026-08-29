import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import {
  acceptAgentQuote,
  describeMerchantForAgent,
  getAgentAuditReceipt,
  getAgentDealSnapshot,
  submitAgentPurchaseIntent,
} from '@/src/application/agent/commerce-tools';
import { hardConstraintSchema } from '@/src/application/agent/rfq-contract';
import { QuoteWorkflowError } from '@/src/application/quote-workflow';

const startSchema = z.object({
  mode: z.literal('start'),
  mandate: z.object({
    rawText: z.string().trim().min(40).max(600),
    hardConstraints: z.array(hardConstraintSchema).max(4),
    quantity: z.number().int().min(10).max(10_000),
    maxUnitPaise: z.number().int().min(10_000).max(10_000_000),
    deliveryLocations: z.array(z.string().trim().min(2).max(80)).min(1).max(10),
    deadline: z.iso.date(),
    agentRunId: z.uuid().optional(),
  }),
});
const resumeSchema = z.object({ mode: z.literal('resume'), dealId: z.uuid() });
const runSchema = z.discriminatedUnion('mode', [startSchema, resumeSchema]);

type Step = {
  tool: string;
  status: 'completed' | 'waiting' | 'blocked';
  title: string;
  summary: string;
};

export async function POST(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return Response.json(
      { error: { code: 'LOCAL_CONSOLE_DISABLED', message: 'The demo agent console is local-only.' } },
      { status: 404 },
    );
  }
  await ensureDatabase(env.DB);
  const parsed = runSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'INVALID_AGENT_RUN', message: 'The buyer-agent run is incomplete.' } },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.mode === 'start') {
      const merchant = await describeMerchantForAgent(env.DB);
      const deal = await submitAgentPurchaseIntent(env.DB, {
        ...parsed.data.mandate,
        agentReviewStatus: parsed.data.mandate.agentRunId ? 'confirmed' : undefined,
      });
      const snapshot = await getAgentDealSnapshot(env.DB, deal.id);
      const recommended = snapshot.options.find((option) => option.key === 'best-value')
        ?? snapshot.options[0]
        ?? null;
      const steps: Step[] = [
        {
          tool: 'describe_merchant',
          status: 'completed',
          title: 'Merchant discovered',
          summary: `${merchant.merchant.name} exposes ${merchant.catalog.length} active products in integer paise.`,
        },
        {
          tool: 'submit_purchase_intent',
          status: 'completed',
          title: 'Buyer mandate recorded',
          summary: `${parsed.data.mandate.quantity} units, capped at ₹${Math.round(parsed.data.mandate.maxUnitPaise / 100).toLocaleString('en-IN')} each.`,
        },
        {
          tool: 'get_deal_options',
          status: recommended ? 'completed' : 'blocked',
          title: recommended ? 'Policy-safe options compared' : 'No safe configuration found',
          summary: recommended
            ? `Recommended ${recommended.label} at ₹${Math.round(recommended.unitTotalPaise / 100).toLocaleString('en-IN')} per kit.`
            : 'The deterministic quote engine could not satisfy the mandate.',
        },
        {
          tool: 'request_merchant_approval',
          status: recommended ? 'waiting' : 'blocked',
          title: recommended ? 'Paused at the merchant gate' : 'Run stopped safely',
          summary: recommended
            ? 'Boli cannot approve its own commercial offer. A merchant must bind approval to one exact quote hash.'
            : 'No financial action was attempted.',
        },
      ];
      return Response.json({
        runId: crypto.randomUUID(),
        stage: recommended ? 'awaiting_merchant_approval' : 'not_fulfillable',
        deal: snapshot.deal,
        recommendedOption: recommended,
        steps,
        resumeInstruction: recommended
          ? 'Approve an option in the merchant desk, then resume this buyer agent.'
          : null,
      });
    }

    const snapshot = await getAgentDealSnapshot(env.DB, parsed.data.dealId);
    const steps: Step[] = [
      {
        tool: 'get_deal_status',
        status: 'completed',
        title: 'Deal state refreshed',
        summary: `The deal is currently ${snapshot.deal.stage.replaceAll('_', ' ')}.`,
      },
    ];
    if (snapshot.deal.stage === 'awaiting_merchant_approval') {
      steps.push({
        tool: 'accept_quote',
        status: 'waiting',
        title: 'Still waiting for the merchant',
        summary: 'No executable quote hash exists, so the agent cannot accept or spend.',
      });
      return Response.json({
        runId: crypto.randomUUID(),
        stage: snapshot.deal.stage,
        deal: snapshot.deal,
        steps,
        resumeInstruction: 'Approve an option in the merchant desk, then resume again.',
      });
    }
    if (!snapshot.currentQuote) {
      throw new QuoteWorkflowError('NO_EXECUTABLE_QUOTE', 'No executable quote is available.', 409);
    }
    const accepted = await acceptAgentQuote(
      env.DB,
      parsed.data.dealId,
      snapshot.currentQuote.quoteHash,
    );
    const audit = await getAgentAuditReceipt(env.DB, parsed.data.dealId);
    steps.push(
      {
        tool: 'accept_quote',
        status: 'completed',
        title: `Accepted quote v${accepted.quote.version}`,
        summary: `Exact hash ${accepted.quote.quoteHash.slice(0, 12)}… matched the merchant approval and buyer mandate.`,
      },
      {
        tool: 'get_audit_receipt',
        status: audit.verified ? 'completed' : 'blocked',
        title: audit.verified ? 'Audit chain verified' : 'Audit verification failed',
        summary: `${audit.events.length} events sealed under ${audit.headHash.slice(0, 12)}….`,
      },
      {
        tool: 'create_checkout',
        status: 'waiting',
        title: 'Stopped before payment',
        summary: 'Quote acceptance grants no payment authority. Razorpay checkout remains a separate explicit gate.',
      },
    );
    return Response.json({
      runId: crypto.randomUUID(),
      stage: 'accepted_waiting_for_checkout',
      deal: snapshot.deal,
      acceptedQuote: {
        version: accepted.quote.version,
        quoteHash: accepted.quote.quoteHash,
        unitTotalPaise: accepted.quote.unitTotalPaise,
        orderTotalPaise: accepted.quote.orderTotalPaise,
        status: accepted.quote.status,
      },
      audit: { verified: audit.verified, headHash: audit.headHash },
      steps,
      resumeInstruction: null,
    });
  } catch (error) {
    if (error instanceof QuoteWorkflowError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    if (error instanceof Error && error.message === 'INVALID_AGENT_TRACE') {
      return Response.json(
        { error: { code: 'INVALID_AGENT_TRACE', message: 'The confirmed interpretation trace is unavailable.' } },
        { status: 400 },
      );
    }
    throw error;
  }
}

import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { assertLocalMerchantWrite } from '@/src/application/merchant-management';
import { respondToCustomQuote } from '@/src/application/custom-quote-workflow';
import { approveQuoteOption, QuoteWorkflowError } from '@/src/application/quote-workflow';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('quote'), message: z.string().trim().min(10).max(600),
    optionKey: z.enum(['best-value','balanced','premium-under-cap']), expectedOption: z.string().max(30000), confirmed: z.literal(true) }),
  z.object({ action: z.enum(['needs_changes','declined']), message: z.string().trim().min(10).max(600) }),
]);
export async function POST(request: Request, { params }: { params: Promise<{dealId: string}> }) {
  try { assertLocalMerchantWrite(request); } catch { return Response.json({ error: { message: 'Use the local store workspace to respond.' } }, { status: 403 }); }
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: { message: 'Review the offer, confirm the requirements and add a reply.' } }, { status: 400 });
  await ensureDatabase(env.DB);
  try {
    const { dealId } = await params;
    const input = parsed.data;
    if (input.action === 'quote') {
      const result = await approveQuoteOption(env.DB, dealId, input.optionKey, new Date().toISOString(), 'merchant', { message: input.message, expectedOption: input.expectedOption });
      return Response.json({ quoteId: result.quote.id });
    }
    return Response.json({ request: await respondToCustomQuote(env.DB, dealId, input.action, input.message) });
  } catch (error) {
    if (error instanceof QuoteWorkflowError) return Response.json({ error: { message: error.message } }, { status: error.status });
    if (/constraint|unique/i.test(String(error))) return Response.json({ error: { message: 'This request changed. Refresh before responding.' } }, { status: 409 });
    throw error;
  }
}

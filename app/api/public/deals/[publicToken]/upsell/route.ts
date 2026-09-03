import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { acceptSafeUpsell } from '@/src/application/upsell-workflow';
import { QuoteWorkflowError } from '@/src/application/quote-workflow';

const schema = z.object({ expectedQuoteHash: z.string().regex(/^[a-f0-9]{64}$/),
  productId: z.string().trim().min(1).max(120), expectedUnitPricePaise: z.number().int().min(1).max(10_000_000) });

export async function POST(request: Request, { params }: { params: Promise<{ publicToken: string }> }) {
  await ensureDatabase(env.DB);
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: { code: 'INVALID_UPSELL', message: 'Upsell request is incomplete.' } }, { status: 400 });
  }
  try {
    const { publicToken } = await params;
    return Response.json(await acceptSafeUpsell(env.DB, publicToken, parsed.data.expectedQuoteHash, {
      productId: parsed.data.productId, expectedUnitPricePaise: parsed.data.expectedUnitPricePaise,
    }));
  } catch (error) {
    if (error instanceof QuoteWorkflowError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    if (/constraint|unique/i.test(String(error))) {
      return Response.json({ error: { code: 'UPSELL_CHANGED', message: 'The order, inventory or store rules changed. Refresh and review the add-on again.' } }, { status: 409 });
    }
    return Response.json({ error: { code: 'UPSELL_UNAVAILABLE', message: 'Could not add this item. Refresh before trying again.' } }, { status: 500 });
  }
}

import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { acceptSafeUpsell } from '@/src/application/upsell-workflow';
import { QuoteWorkflowError } from '@/src/application/quote-workflow';

const schema = z.object({ expectedQuoteHash: z.string().regex(/^[a-f0-9]{64}$/) });

export async function POST(request: Request, { params }: { params: Promise<{ publicToken: string }> }) {
  await ensureDatabase(env.DB);
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: { code: 'INVALID_UPSELL', message: 'Upsell request is incomplete.' } }, { status: 400 });
  }
  try {
    const { publicToken } = await params;
    return Response.json(await acceptSafeUpsell(env.DB, publicToken, parsed.data.expectedQuoteHash));
  } catch (error) {
    if (error instanceof QuoteWorkflowError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    throw error;
  }
}

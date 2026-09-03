import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { chooseCounteroffer } from '@/src/application/counteroffer-workflow';
import { QuoteWorkflowError } from '@/src/application/quote-workflow';
export async function POST(request: Request, { params }: { params: Promise<{publicToken: string}> }) {
  const parsed = z.object({ counterofferId: z.uuid(), expectedQuoteHash: z.string().regex(/^[a-f0-9]{64}$/), choice: z.enum(['original','revised']) }).safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: { message: 'Choose an available offer.' } }, { status: 400 });
  await ensureDatabase(env.DB);
  try { return Response.json(await chooseCounteroffer(env.DB, (await params).publicToken, parsed.data)); }
  catch (error) {
    if (error instanceof QuoteWorkflowError) return Response.json({ error: { message: error.message } }, { status: error.status });
    throw error;
  }
}

import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { requestCustomQuote } from '@/src/application/custom-quote-workflow';
import { QuoteWorkflowError } from '@/src/application/quote-workflow';

export async function POST(request: Request, { params }: { params: Promise<{publicToken: string}> }) {
  const parsed = z.object({ note: z.string().trim().min(3).max(600) }).safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: { message: 'Add a short note for the store.' } }, { status: 400 });
  await ensureDatabase(env.DB);
  try {
    const { publicToken } = await params;
    return Response.json({ request: await requestCustomQuote(env.DB, publicToken, parsed.data.note) });
  } catch (error) {
    if (error instanceof QuoteWorkflowError) return Response.json({ error: { message: error.message } }, { status: error.status });
    throw error;
  }
}

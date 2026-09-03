import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { assertLocalMerchantWrite, saveMerchantRules } from '@/src/application/merchant-management';
const schema = z.object({ expectedVersion: z.number().int().positive(), minimumMarginBps: z.number().int().min(0).max(9500), maximumAutomaticConcessionBps: z.number().int().min(0).max(5000) });
export async function POST(request: Request) {
  try {
    assertLocalMerchantWrite(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: 'Enter a margin between 0–95% and a discount limit between 0–50%.' }, { status: 400 });
    await ensureDatabase(env.DB);
    return Response.json(await saveMerchantRules(env.DB, parsed.data));
  } catch (error) { return Response.json({ error: error instanceof Error && !/constraint/i.test(error.message) ? error.message : 'The rules changed. Refresh and try again.' }, { status: 409 }); }
}

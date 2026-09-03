import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { ensureDatabase } from '@/src/adapters/db/database';
import { assertLocalMerchantWrite, saveMerchantProduct } from '@/src/application/merchant-management';
const schema = z.object({ expectedVersion: z.number().int().positive(), pricePaise: z.number().int().positive().max(10000000), costPaise: z.number().int().min(0).max(10000000), stock: z.number().int().min(0).max(1000000), days: z.number().int().min(0).max(365) }).refine(value => value.costPaise <= value.pricePaise);
export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    assertLocalMerchantWrite(request);
    const input = schema.safeParse(await request.json());
    if (!input.success) return Response.json({ error: 'Check price, cost, stock and lead time. Cost cannot exceed the selling price.' }, { status: 400 });
    await ensureDatabase(env.DB);
    await saveMerchantProduct(env.DB, (await params).productId, input.data);
    return Response.json({ saved: true });
  } catch (error) { return Response.json({ error: error instanceof Error && !/constraint/i.test(error.message) ? error.message : 'Inventory changed while saving. Refresh and try again.' }, { status: 409 }); }
}

import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';

export async function GET() {
  await ensureDatabase(env.DB);
  await env.DB.prepare('SELECT 1').first();

  return Response.json({ status: 'ready', database: 'connected' });
}

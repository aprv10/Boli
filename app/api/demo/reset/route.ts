import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return new Response(null, { status: 404 });
  }

  await ensureDatabase(env.DB);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM quote_events'),
    env.DB.prepare('DELETE FROM counteroffers'),
    env.DB.prepare('DELETE FROM quotes'),
    env.DB.prepare('DELETE FROM deals'),
    env.DB.prepare('DELETE FROM intent_agent_runs'),
    env.DB.prepare('DELETE FROM purchase_requirements'),
    env.DB.prepare('DELETE FROM purchase_intents'),
    env.DB.prepare('DELETE FROM agent_runs'),
  ]);

  return Response.json({ status: 'reset' });
}

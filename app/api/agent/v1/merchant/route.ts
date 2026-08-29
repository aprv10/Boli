import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { authorizeAgentRequest } from '@/src/application/agent/agent-access';
import { describeMerchantForAgent } from '@/src/application/agent/commerce-tools';

export async function GET(request: Request) {
  if (!(await authorizeAgentRequest(request))) {
    return Response.json(
      { error: { code: 'AGENT_UNAUTHORIZED', message: 'Agent credentials are missing or invalid.' } },
      { status: 401 },
    );
  }
  await ensureDatabase(env.DB);
  return Response.json({ ok: true, result: await describeMerchantForAgent(env.DB) });
}

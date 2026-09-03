import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { authorizeLocalAgentConsole } from '@/src/application/agent/agent-access';
import { agentRunRequest } from '@/src/application/agent/commerce-contract';
import { runGuidedBuyer } from '@/src/application/agent/guided-buyer';
import { QuoteWorkflowError } from '@/src/application/quote-workflow';

export async function POST(request: Request) {
  if (!authorizeLocalAgentConsole(request)) {
    return Response.json({ error: { code: 'LOCAL_CONSOLE_DISABLED', message: 'The guided demo is available only in the same-origin local workspace.' } }, { status: 403 });
  }
  const parsed = agentRunRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: 'INVALID_AGENT_RUN', message: parsed.error.issues[0]?.message ?? 'Review the buyer request before continuing.' } }, { status: 400 });
  }
  await ensureDatabase(env.DB);
  try {
    return Response.json(await runGuidedBuyer(env.DB, parsed.data, env.MISTRAL_API_KEY ?? process.env.MISTRAL_API_KEY));
  } catch (error) {
    if (error instanceof QuoteWorkflowError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    if (error instanceof Error && error.message === 'INVALID_AGENT_TRACE') {
      return Response.json({ error: { code: 'INVALID_AGENT_TRACE', message: 'The interpretation trace is unavailable. Read the request again or enter it manually.' } }, { status: 400 });
    }
    if (/constraint|unique/i.test(String(error))) {
      return Response.json({ error: { code: 'ORDER_CHANGED', message: 'The order, products or policy changed. Refresh the result before continuing.' } }, { status: 409 });
    }
    return Response.json({ error: { code: 'AGENT_RUN_UNAVAILABLE', message: 'The action could not be confirmed. Refresh an existing result before trying again.' } }, { status: 500 });
  }
}

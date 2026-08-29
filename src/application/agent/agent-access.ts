function configuredKey() {
  return process.env.BOLI_AGENT_API_KEY?.trim();
}

async function equalSecret(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export async function authorizeAgentRequest(request: Request) {
  const key = configuredKey();
  if (key) {
    const authorization = request.headers.get('authorization') ?? '';
    const provided = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    return provided.length > 0 && (await equalSecret(provided, key));
  }
  const hostname = new URL(request.url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function agentAccessMode() {
  return configuredKey() ? 'bearer_token' : 'local_demo_only';
}

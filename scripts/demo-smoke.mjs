const baseUrl = process.env.BOLI_LOCAL_URL ?? 'http://localhost:3000';

async function call(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${body.error?.code ?? 'UNKNOWN'}`);
  }
  return body;
}

function json(body) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

const deadline = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
await call('/api/demo/reset', { method: 'POST' });
const created = await call('/api/intents', json({
  rawText: 'Need 80 vegan, plastic-free, branded welcome kits split between Hyderabad and Chennai. Dairy substitutions are forbidden and every money action must stay inside the mandate.',
  hardConstraints: ['vegan', 'plastic-free', 'branded', 'multi-city'],
  quantity: 80,
  maxUnitPaise: 90_000,
  deliveryLocations: ['Hyderabad', 'Chennai'],
  deadline,
}));
const { id: dealId, publicToken } = created.deal;
const approved = await call(`/api/deals/${dealId}/quotes`, json({ optionKey: 'best-value' }));
const quoteHash = approved.quote.quoteHash;
await call(`/api/public/deals/${publicToken}/accept`, json({ expectedQuoteHash: quoteHash }));

const checkoutKey = crypto.randomUUID();
const checkout = await call(`/api/public/deals/${publicToken}/checkout`, json({
  expectedQuoteHash: quoteHash,
  idempotencyKey: checkoutKey,
}));
const checkoutReplay = await call(`/api/public/deals/${publicToken}/checkout`, json({
  expectedQuoteHash: quoteHash,
  idempotencyKey: checkoutKey,
}));
if (!checkoutReplay.reused) throw new Error('Checkout replay did not reuse the existing order.');

const orderId = checkout.state.order.providerOrderId;
await call(`/api/demo/payments/${encodeURIComponent(orderId)}/capture`, { method: 'POST' });
const webhookReplay = await call(`/api/demo/payments/${encodeURIComponent(orderId)}/capture`, { method: 'POST' });
if (!webhookReplay.duplicate) throw new Error('Webhook replay was not deduplicated.');

const failure = await call(`/api/merchant/deals/${dealId}/fulfilment-failure`, { method: 'POST' });
if (failure.state.stage !== 'replacement_offered') throw new Error('Unsafe substitute was not blocked.');

const refundKey = crypto.randomUUID();
const refund = await call(`/api/public/deals/${publicToken}/replacement/decline`, json({
  idempotencyKey: refundKey,
}));
const refundReplay = await call(`/api/public/deals/${publicToken}/replacement/decline`, json({
  idempotencyKey: refundKey,
}));
if (refund.state.stage !== 'refunded' || !refundReplay.reused) {
  throw new Error('Refund was not processed exactly once.');
}

const audit = await call('/api/agent/v1/tools', json({
  tool: 'get_audit_receipt',
  input: { dealId },
}));
if (!audit.result.verified || audit.result.events.at(-1)?.action !== 'refund_processed') {
  throw new Error('Final audit receipt did not verify.');
}

console.log(JSON.stringify({
  status: 'passed',
  dealId,
  quoteHash: `${quoteHash.slice(0, 16)}…`,
  providerOrderId: orderId,
  providerRefundId: refund.state.refund.providerRefundId,
  auditEvents: audit.result.events.length,
  auditHead: `${audit.result.headHash.slice(0, 16)}…`,
}, null, 2));

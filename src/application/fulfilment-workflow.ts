import { prepareAuditBatch } from './audit-ledger';
import {
  issueFullRefund,
  loadDealPaymentState,
  PaymentWorkflowError,
} from './payment-workflow';
import { loadPublicDealRoom } from './quote-workflow';
import { evaluateSubstitution } from '@/src/domain/fulfilment/substitution-policy';

type ProductRow = {
  id: string;
  name: string;
  category: string;
  tagsJson: string;
  unitPricePaise: number;
  availableQuantity: number;
  reservedQuantity: number;
};

export async function reportDemoFulfilmentFailure(
  binding: D1Database,
  dealId: string,
  now = new Date().toISOString(),
) {
  if (process.env.NODE_ENV === 'production') {
    throw new PaymentWorkflowError('DEMO_DISABLED', 'Demo failure controls are disabled.', 404);
  }
  const existing = await binding
    .prepare('SELECT id FROM fulfilment_incidents WHERE deal_id = ?')
    .bind(dealId)
    .first();
  if (existing) return { state: await loadDealPaymentState(binding, dealId), reused: true };
  const deal = await binding
    .prepare('SELECT public_token AS publicToken FROM deals WHERE id = ?')
    .bind(dealId)
    .first<{ publicToken: string }>();
  if (!deal) throw new PaymentWorkflowError('DEAL_NOT_FOUND', 'Deal unavailable.', 404);
  const room = await loadPublicDealRoom(binding, deal.publicToken);
  const paymentState = await loadDealPaymentState(binding, dealId);
  if (!room?.currentQuote || paymentState.stage !== 'paid' || !paymentState.payment) {
    throw new PaymentWorkflowError(
      'PAYMENT_NOT_CAPTURED',
      'The fulfilment failure can be reported only after a verified payment.',
      409,
    );
  }
  if (!room.deal.hardConstraints.includes('vegan')) {
    throw new PaymentWorkflowError(
      'VEGAN_DEMO_REQUIRED',
      'Use a vegan buyer mandate for the flagship substitution failure.',
      409,
    );
  }
  const productIds = room.currentQuote.lines
    .filter((line) => line.kind === 'product' && line.productId)
    .map((line) => line.productId as string);
  const productResults = await binding.batch(
    productIds.map((productId) =>
      binding
        .prepare(
          `SELECT id, name, category, tags_json AS tagsJson,
            unit_price_paise AS unitPricePaise, available_quantity AS availableQuantity,
            reserved_quantity AS reservedQuantity FROM products WHERE id = ?`,
        )
        .bind(productId),
    ),
  );
  const failedProduct = productResults
    .map((result) => result.results[0] as ProductRow | undefined)
    .find((product) => product?.category === 'snack');
  if (!failedProduct) {
    throw new PaymentWorkflowError('SNACK_RESERVATION_NOT_FOUND', 'Paid snack allocation unavailable.', 409);
  }
  const blockedSubstitute = await binding
    .prepare(
      `SELECT id, name, category, tags_json AS tagsJson,
        unit_price_paise AS unitPricePaise, available_quantity AS availableQuantity,
        reserved_quantity AS reservedQuantity FROM products WHERE id = 'prod-cookies'`,
    )
    .first<ProductRow>();
  if (!blockedSubstitute) {
    throw new PaymentWorkflowError('DEMO_SUBSTITUTE_NOT_FOUND', 'Demo substitute unavailable.', 409);
  }
  const blockedDecision = evaluateSubstitution(
    room.deal.hardConstraints,
    JSON.parse(blockedSubstitute.tagsJson) as string[],
  );
  if (blockedDecision.allowed) {
    throw new PaymentWorkflowError('DEMO_CONSTRAINT_NOT_BLOCKED', 'The unsafe substitute was not blocked.', 500);
  }
  const snacks = await binding
    .prepare(
      `SELECT id, name, category, tags_json AS tagsJson,
        unit_price_paise AS unitPricePaise, available_quantity AS availableQuantity,
        reserved_quantity AS reservedQuantity
       FROM products WHERE category = 'snack' AND active = 1 AND id != ?`,
    )
    .bind(failedProduct.id)
    .all<ProductRow>();
  const compliantReplacement = snacks.results.find((product) => {
    const tags = JSON.parse(product.tagsJson) as string[];
    return (
      product.availableQuantity - product.reservedQuantity >= room.deal.quantity &&
      evaluateSubstitution(room.deal.hardConstraints, tags).allowed
    );
  });
  if (!compliantReplacement) {
    throw new PaymentWorkflowError(
      'NO_COMPLIANT_REPLACEMENT',
      'No replacement preserves the buyer’s locked requirements.',
      409,
    );
  }

  const reservation = await binding
    .prepare(
      `SELECT id, quantity FROM inventory_reservations
       WHERE quote_id = ? AND product_id = ? AND status = 'reserved'`,
    )
    .bind(room.currentQuote.id, failedProduct.id)
    .first<{ id: string; quantity: number }>();
  if (!reservation) {
    throw new PaymentWorkflowError('RESERVATION_NOT_FOUND', 'Paid inventory reservation unavailable.', 409);
  }
  const incidentId = crypto.randomUUID();
  const replacement = {
    failedProduct: failedProduct.name,
    blockedSubstitute: blockedSubstitute.name,
    compliantReplacement: compliantReplacement.name,
    buyerImpact: 'No extra charge. The merchant absorbs any replacement cost difference.',
  };
  const audit = await prepareAuditBatch(binding, dealId, [
    {
      id: crypto.randomUUID(),
      quoteId: room.currentQuote.id,
      eventType: 'fulfilment_substitution_blocked',
      actorType: 'system',
      summary: `Blocked ${blockedSubstitute.name} because it violates the vegan mandate.`,
      data: {
        failedProductId: failedProduct.id,
        blockedSubstituteProductId: blockedSubstitute.id,
        checks: blockedDecision.checks,
        reasonCodes: blockedDecision.reasonCodes,
      },
      createdAt: now,
    },
    {
      id: crypto.randomUUID(),
      quoteId: room.currentQuote.id,
      eventType: 'compliant_replacement_offered',
      actorType: 'merchant',
      summary: `Offered ${compliantReplacement.name} without changing the accepted total.`,
      data: {
        replacementProductId: compliantReplacement.id,
        originalUnitPaise: failedProduct.unitPricePaise,
        replacementUnitPaise: compliantReplacement.unitPricePaise,
        buyerChargeDeltaPaise: 0,
      },
      createdAt: now,
    },
  ]);
  await binding.batch([
    binding
      .prepare(
        `UPDATE products SET available_quantity = MAX(0, available_quantity - ?),
          reserved_quantity = MAX(0, reserved_quantity - ?),
          inventory_version = inventory_version + 1 WHERE id = ?`,
      )
      .bind(reservation.quantity, reservation.quantity, failedProduct.id),
    binding
      .prepare("UPDATE inventory_reservations SET status = 'lost', updated_at = ? WHERE id = ?")
      .bind(now, reservation.id),
    binding
      .prepare(
        `INSERT INTO fulfilment_incidents (
          id, deal_id, quote_id, failed_product_id, blocked_substitute_product_id,
          status, failure_code, explanation, replacement_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'replacement_offered', 'POST_PAYMENT_STOCK_LOSS', ?, ?, ?, ?)`,
      )
      .bind(
        incidentId,
        dealId,
        room.currentQuote.id,
        failedProduct.id,
        blockedSubstitute.id,
        `${failedProduct.name} became unavailable after payment. The obvious substitute contains dairy, so Boli blocked it instead of relaxing the vegan constraint.`,
        JSON.stringify(replacement),
        now,
        now,
      ),
    ...audit.statements,
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, dealId),
  ]);
  return { state: await loadDealPaymentState(binding, dealId), reused: false };
}

export async function declineReplacementAndRefund(
  binding: D1Database,
  publicToken: string,
  idempotencyKey: string,
  now = new Date().toISOString(),
) {
  const deal = await binding
    .prepare('SELECT id FROM deals WHERE public_token = ?')
    .bind(publicToken)
    .first<{ id: string }>();
  if (!deal) throw new PaymentWorkflowError('DEAL_NOT_FOUND', 'Deal unavailable.', 404);
  const incident = await binding
    .prepare('SELECT id, quote_id AS quoteId, status FROM fulfilment_incidents WHERE deal_id = ?')
    .bind(deal.id)
    .first<{ id: string; quoteId: string; status: string }>();
  if (!incident) {
    throw new PaymentWorkflowError('RECOVERY_OFFER_NOT_FOUND', 'No recovery offer is awaiting a decision.', 409);
  }
  if (incident.status === 'refunded') {
    return { state: await loadDealPaymentState(binding, deal.id), reused: true };
  }
  if (incident.status === 'replacement_offered') {
    const audit = await prepareAuditBatch(binding, deal.id, [
      {
        id: crypto.randomUUID(),
        quoteId: incident.quoteId,
        eventType: 'replacement_declined',
        actorType: 'buyer',
        summary: 'Buyer declined the compliant replacement and requested a full refund.',
        data: { incidentId: incident.id, nextAction: 'policy_gated_refund' },
        createdAt: now,
      },
    ]);
    await binding.batch([
      binding
        .prepare("UPDATE fulfilment_incidents SET status = 'buyer_declined', updated_at = ? WHERE id = ? AND status = 'replacement_offered'")
        .bind(now, incident.id),
      ...audit.statements,
    ]);
  }
  const refund = await issueFullRefund(
    binding,
    deal.id,
    idempotencyKey,
    'Buyer declined the compliant post-payment replacement.',
    now,
  );
  const finalStatus = refund.state.refund?.status === 'processed' ? 'refunded' : 'refund_pending';
  await binding
    .prepare('UPDATE fulfilment_incidents SET status = ?, updated_at = ? WHERE id = ?')
    .bind(finalStatus, now, incident.id)
    .run();
  return { state: await loadDealPaymentState(binding, deal.id), reused: refund.reused };
}

export async function acceptCompliantReplacement(
  binding: D1Database,
  publicToken: string,
  now = new Date().toISOString(),
) {
  const deal = await binding
    .prepare('SELECT id FROM deals WHERE public_token = ?')
    .bind(publicToken)
    .first<{ id: string }>();
  if (!deal) throw new PaymentWorkflowError('DEAL_NOT_FOUND', 'Deal unavailable.', 404);
  const incident = await binding
    .prepare(
      `SELECT id, quote_id AS quoteId, status, replacement_json AS replacementJson,
        accepted_at AS acceptedAt FROM fulfilment_incidents WHERE deal_id = ?`,
    )
    .bind(deal.id)
    .first<{ id: string; quoteId: string; status: string; replacementJson: string; acceptedAt: string | null }>();
  if (!incident || incident.status !== 'replacement_offered') {
    throw new PaymentWorkflowError('RECOVERY_OFFER_NOT_FOUND', 'No replacement is awaiting a decision.', 409);
  }
  if (incident.acceptedAt) return { state: await loadDealPaymentState(binding, deal.id), reused: true };
  const replacement = JSON.parse(incident.replacementJson) as { compliantReplacement: string };
  const quote = await binding
    .prepare('SELECT quantity FROM quotes WHERE id = ?')
    .bind(incident.quoteId)
    .first<{ quantity: number }>();
  const product = await binding
    .prepare(
      `SELECT id, available_quantity AS availableQuantity, reserved_quantity AS reservedQuantity
       FROM products WHERE name = ? AND active = 1`,
    )
    .bind(replacement.compliantReplacement)
    .first<{ id: string; availableQuantity: number; reservedQuantity: number }>();
  if (!quote || !product || product.availableQuantity - product.reservedQuantity < quote.quantity) {
    throw new PaymentWorkflowError('REPLACEMENT_INVENTORY_CHANGED', 'The replacement is no longer available.', 409);
  }
  const audit = await prepareAuditBatch(binding, deal.id, [
    {
      id: crypto.randomUUID(),
      quoteId: incident.quoteId,
      eventType: 'compliant_replacement_accepted',
      actorType: 'buyer',
      summary: `Buyer accepted ${replacement.compliantReplacement}; locked constraints and order total stayed unchanged.`,
      data: { incidentId: incident.id, replacementProductId: product.id, buyerChargeDeltaPaise: 0 },
      createdAt: now,
    },
  ]);
  await binding.batch([
    binding
      .prepare(
        `UPDATE products SET available_quantity = available_quantity - ?,
          inventory_version = inventory_version + 1 WHERE id = ?`,
      )
      .bind(quote.quantity, product.id),
    binding
      .prepare("UPDATE fulfilment_incidents SET accepted_at = ?, updated_at = ? WHERE id = ? AND accepted_at IS NULL")
      .bind(now, now, incident.id),
    ...audit.statements,
    binding.prepare('UPDATE deals SET updated_at = ? WHERE id = ?').bind(now, deal.id),
  ]);
  return { state: await loadDealPaymentState(binding, deal.id), reused: false };
}

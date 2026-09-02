import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { loadDealCounteroffers } from '@/src/application/counteroffer-workflow';
import { loadPublicDealRoom } from '@/src/application/quote-workflow';
import { loadPublicPaymentState } from '@/src/application/payment-workflow';
import type { ConstraintCheck } from '@/src/domain/quoting/types';
import { AcceptQuoteButton } from './accept-quote-button';
import { CounterofferPanel } from './counteroffer-panel';
import { CheckoutPanel } from './checkout-panel';
import { SiteHeader } from '../../site-header';

type DealRoomPageProps = { params: Promise<{ publicToken: string }> };

function formatMoney(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

function formatMoment(timestamp: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ');
}

const checkLabels: Record<string, string> = {
  BUYER_UNIT_BUDGET: 'Inside buyer budget',
  BUYER_TARGET_PRICE: 'Buyer target respected',
  BUYER_ORIGINAL_CAP: 'Original mandate respected',
  MERCHANT_MARGIN_FLOOR: 'Merchant margin protected',
  AUTOMATIC_CONCESSION_LIMIT: 'Inside automatic authority',
  INVENTORY_AVAILABLE: 'Inventory available',
  LEAD_TIME_FEASIBLE: 'Delivery timeline feasible',
  HARD_CONSTRAINTS_PRESERVED: 'Locked requirements preserved',
};

function requirementNumber(value: string) {
  const match = value.match(/^(?:<=|>=)(\d+)$/);
  return match ? Number(match[1]) : null;
}

function presentCheck(check: ConstraintCheck) {
  const label =
    checkLabels[check.code] ??
    (check.code.startsWith('HARD_CONSTRAINT_')
      ? `${check.required.replace('-', ' ')} requirement locked`
      : check.code.replaceAll('_', ' ').toLowerCase());
  const threshold = requirementNumber(check.required);

  if (
    ['BUYER_UNIT_BUDGET', 'BUYER_TARGET_PRICE', 'BUYER_ORIGINAL_CAP'].includes(
      check.code,
    )
  ) {
    return {
      label,
      value: formatMoney(Number(check.observed)),
      requirement:
        threshold === null ? check.required : `limit ${formatMoney(threshold)}`,
    };
  }
  if (
    ['MERCHANT_MARGIN_FLOOR', 'AUTOMATIC_CONCESSION_LIMIT'].includes(
      check.code,
    )
  ) {
    return {
      label,
      value: `${(Number(check.observed) / 100).toFixed(1)}%`,
      requirement:
        threshold === null
          ? check.required
          : check.code === 'MERCHANT_MARGIN_FLOOR'
            ? `minimum ${(threshold / 100).toFixed(1)}%`
            : `authority ${(threshold / 100).toFixed(1)}%`,
    };
  }
  if (check.code === 'INVENTORY_AVAILABLE') {
    return {
      label,
      value: `${check.observed} units ready`,
      requirement: threshold === null ? check.required : `${threshold} needed`,
    };
  }
  if (check.code === 'LEAD_TIME_FEASIBLE') {
    return {
      label,
      value: `${check.observed} lead time`,
      requirement: `within ${check.required.replace('<=', '')}`,
    };
  }
  if (check.code === 'HARD_CONSTRAINTS_PRESERVED') {
    return {
      label,
      value: check.observed.replaceAll(',', ' · ').replaceAll('-', ' '),
      requirement: 'unchanged',
    };
  }
  return { label, value: check.observed, requirement: check.required };
}

export async function generateMetadata({ params }: DealRoomPageProps): Promise<Metadata> {
  const { publicToken } = await params;
  return {
    title: `Buyer Deal Room ${publicToken.slice(0, 8).toUpperCase()} — Boli`,
    description: 'Review and accept one exact, merchant-approved Boli quote.',
    openGraph: { images: [] },
    twitter: { images: [] },
  };
}

export default async function DealRoomPage({ params }: DealRoomPageProps) {
  const { publicToken } = await params;
  await ensureDatabase(env.DB);
  const room = await loadPublicDealRoom(env.DB, publicToken);
  if (!room) notFound();
  const payment = await loadPublicPaymentState(env.DB, publicToken);
  if (!payment) notFound();
  const counterofferHistory = await loadDealCounteroffers(env.DB, room.deal.id);

  const quote = room.currentQuote;
  const isExpired = quote
    ? Date.parse(quote.expiresAt) <= Date.parse(room.evaluatedAt)
    : false;
  const accepted = quote?.status === 'buyer_accepted';
  const previousQuote = quote
    ? room.quoteHistory.find((item) => item.version === quote.version - 1)
    : undefined;
  const currentProducts = quote?.lines.filter((line) => line.kind === 'product') ?? [];
  const previousProducts =
    previousQuote?.lines.filter((line) => line.kind === 'product') ?? [];
  const changedLineCodes = new Set(
    quote?.lines
      .filter((line) => {
        if (line.kind === 'product') {
          const position = currentProducts.findIndex((item) => item.code === line.code);
          return previousProducts[position]?.code !== line.code;
        }
        const previousLine = previousQuote?.lines.find((item) => item.code === line.code);
        return previousLine?.unitPricePaise !== line.unitPricePaise;
      })
      .map((line) => line.code) ?? [],
  );
  const changedProductCount = currentProducts.filter((line) =>
    changedLineCodes.has(line.code),
  ).length;
  const perKitSavings = previousQuote && quote
    ? previousQuote.unitTotalPaise - quote.unitTotalPaise
    : 0;
  const uniquePolicyChecks = quote
    ? [...new Map(quote.checks.map((check) => [check.code, check])).values()]
    : [];
  const hasPreservedConstraintCheck = uniquePolicyChecks.some(
    (check) => check.code === 'HARD_CONSTRAINTS_PRESERVED',
  );
  const policyChecks = hasPreservedConstraintCheck
    ? uniquePolicyChecks.filter(
        (check) => !check.code.startsWith('HARD_CONSTRAINT_'),
      )
    : uniquePolicyChecks;

  return (
    <main className="deal-room-shell">
      <SiteHeader active="buyer" context="Your Deal Room" />
      <div className="deal-progress-bar">
        <Link href="/request">← Back to buyer workspace</Link>
        <div className="deal-room-progress" aria-label="Deal progress">
          <span className="complete">01 Mandate</span>
          <span className="complete">02 Quote</span>
          <span className={accepted ? 'complete' : 'active'}>03 Accept</span>
          <span className={payment.stage === 'paid' || payment.stage === 'refunded' ? 'complete' : accepted ? 'active' : ''}>04 Pay</span>
        </div>
      </div>

      <section className="deal-room-hero">
        <div>
          <p className="eyebrow"><span aria-hidden="true">✦</span> Your approved quote</p>
          <h1>Review the deal.<br /><em>Then decide.</em></h1>
        </div>
        <div className="deal-room-mandate">
          <span>Buyer mandate</span>
          <p>{room.deal.rawText}</p>
          <div>
            <strong>{room.deal.quantity} kits</strong>
            <strong>{formatMoney(room.deal.maxUnitPaise)} max / kit</strong>
            <strong>{room.deal.deliveryLocations.join(' · ')}</strong>
          </div>
        </div>
      </section>

      {!quote ? (
        <section className="deal-room-waiting">
          <span aria-hidden="true">◇</span>
          <h2>The merchant is still shaping your quote.</h2>
          <p>Your mandate is saved. Nothing can be accepted or charged until an exact quote is approved.</p>
        </section>
      ) : (
        <section className="deal-room-grid">
          <article className="executable-quote">
            <div className="executable-quote-topline">
              <div>
                <span>Quote v{quote.version} · {quote.label}</span>
                <h2>{formatMoney(quote.unitTotalPaise)} <small>/ kit</small></h2>
              </div>
              <span className={`quote-state quote-state-${quote.status}`}>
                {isExpired && !accepted ? 'expired' : statusLabel(quote.status)}
              </span>
            </div>

            <p className="executable-rationale">{quote.rationale}</p>

            <section className="deal-decision-deck" aria-label="Quote decision">
              <div>
                <span>{accepted ? 'Decision recorded' : 'Ready for your decision'}</span>
                <strong>{formatMoney(quote.orderTotalPaise)} exact total</strong>
                <p>
                  {accepted
                    ? `Acceptance is bound to quote v${quote.version} and its fingerprint.`
                    : 'Accept this exact version, or ask Boli to find a different policy-safe shape.'}
                </p>
              </div>
              <div className="deal-decision-actions">
                {!accepted && !isExpired ? <a href="#negotiate">Negotiate</a> : null}
                {isExpired && !accepted ? (
                  <div className="deal-room-expired">
                    <strong>Acceptance blocked</strong>
                    This quote expired. The merchant must issue a new version.
                  </div>
                ) : (
                  <AcceptQuoteButton
                    publicToken={publicToken}
                    quoteHash={quote.quoteHash}
                    disabled={isExpired}
                    accepted={accepted}
                  />
                )}
              </div>
            </section>

            {previousQuote && perKitSavings > 0 ? (
              <section className="quote-delta" aria-label="What changed in this quote">
                <div className="quote-delta-version">
                  <span>v{previousQuote.version}</span>
                  <i aria-hidden="true">→</i>
                  <strong>v{quote.version}</strong>
                </div>
                <div>
                  <span>Price movement</span>
                  <strong>{formatMoney(perKitSavings)} less / kit</strong>
                  <small>{formatMoney(perKitSavings * quote.quantity)} saved on this order</small>
                </div>
                <div>
                  <span>Composition</span>
                  <strong>{changedProductCount} {changedProductCount === 1 ? 'item' : 'items'} changed</strong>
                  <small>Services recalculated from the new kit</small>
                </div>
                <div>
                  <span>Buyer mandate</span>
                  <strong>Every lock preserved</strong>
                  <small>{room.deal.hardConstraints.length} non-negotiable requirements</small>
                </div>
              </section>
            ) : null}

            <div className="quote-detail-heading">
              <div><span>Kit composition</span><h3>Inside every kit</h3></div>
              <small>{currentProducts.length} products · {quote.lines.length - currentProducts.length} services</small>
            </div>

            <div className="executable-lines executable-product-lines">
              {currentProducts.map((line) => (
                <div className={changedLineCodes.has(line.code) ? 'line-changed' : ''} key={line.code}>
                  <span>{changedLineCodes.has(line.code) ? `Changed in v${quote.version}` : 'Product'}</span>
                  <p>{line.label}</p>
                  <strong>{formatMoney(line.unitPricePaise)}</strong>
                </div>
              ))}
            </div>

            <details className="service-costs">
              <summary>
                <span>Services & operational costs</span>
                <strong>
                  {formatMoney(
                    quote.lines
                      .filter((line) => line.kind === 'service')
                      .reduce((total, line) => total + line.unitPricePaise, 0),
                  )} / kit
                </strong>
              </summary>
              <div>
                {quote.lines.filter((line) => line.kind === 'service').map((line) => (
                  <p key={line.code}>
                    <span>{line.label}</span>
                    <strong>{formatMoney(line.unitPricePaise)}</strong>
                  </p>
                ))}
              </div>
            </details>

            <dl className="executable-totals">
              <div><dt>Quantity</dt><dd>{quote.quantity}</dd></div>
              <div><dt>Merchant margin</dt><dd>{(quote.contributionMarginBps / 100).toFixed(1)}%</dd></div>
              <div><dt>Valid until</dt><dd>{formatMoment(quote.expiresAt)}</dd></div>
              <div className="executable-grand-total"><dt>Exact order total</dt><dd>{formatMoney(quote.orderTotalPaise)}</dd></div>
            </dl>

            <details className="quote-technical-details">
              <summary>Quote and approval details</summary>
              <div className="quote-identity">
                <div>
                  <span>Quote fingerprint · SHA-256</span>
                  <code>{quote.quoteHash}</code>
                </div>
                <p>The merchant approval and your acceptance both point to this exact fingerprint.</p>
              </div>
            </details>

            {accepted ? (
              <CheckoutPanel
                publicToken={publicToken}
                quoteHash={quote.quoteHash}
                amountPaise={quote.orderTotalPaise}
                payment={{
                  stage: payment.stage,
                  order: payment.order,
                  providerPaymentId: payment.payment?.providerPaymentId ?? null,
                  refund: payment.refund,
                  incident: payment.incident,
                }}
              />
            ) : null}

            {!accepted ? (
              <CounterofferPanel
                publicToken={publicToken}
                quoteHash={quote.quoteHash}
                currentUnitPaise={quote.unitTotalPaise}
                hardConstraints={room.deal.hardConstraints}
                disabled={isExpired}
              />
            ) : null}

          </article>

          <aside className="deal-room-proof">
            <section className="deal-safety-summary">
              <p className="micro-label">Checked by Boli</p>
              <h2>Why this quote is safe</h2>
              <div className="deal-room-checks">
                {policyChecks.slice(0, 4).map((check) => {
                  const presented = presentCheck(check);
                  return (
                    <div key={check.code}>
                      <span aria-hidden="true">✓</span>
                      <p><strong>{presented.label}</strong>{presented.value}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <details className="deal-proof-details">
              <summary>Audit and technical details <span>{room.auditVerified ? 'Verified' : 'Review'}</span></summary>
              <div className="deal-proof-detail-body">
                <section className={`audit-integrity ${room.auditVerified ? 'verified' : 'unverified'}`}>
                  <div className="audit-integrity-heading">
                    <p className="micro-label">Cryptographic receipt</p>
                    <span>{room.auditVerified ? 'Chain verified' : 'Integrity warning'}</span>
                  </div>
                  <h2>Every decision leaves a fingerprint.</h2>
                  <p>Each action commits to the one before it. Editing an amount, approval, or actor would break the chain.</p>
                  <dl>
                    <div><dt>Policy</dt><dd>v{quote.policyVersion}</dd></div>
                    <div><dt>Events sealed</dt><dd>{room.events.length}</dd></div>
                    <div><dt>Ledger head</dt><dd><code>{room.auditHeadHash.slice(0, 18)}…</code></dd></div>
                  </dl>
                </section>
                <section className="deal-room-timeline">
                  <p className="micro-label">Append-only activity</p>
                  <h2>Decision trail</h2>
                  {room.events.map((event) => (
                    <article key={event.id}>
                      <span>{String(event.sequence).padStart(2, '0')}</span>
                      <div><p>{event.summary}</p><small>{event.actorType} · {formatMoment(event.createdAt)}</small><code className="event-fingerprint">{event.eventHash.slice(0, 12)}…</code></div>
                    </article>
                  ))}
                </section>
                <section className="quote-version-history">
                  <p className="micro-label">Quote history</p>
                  {room.quoteHistory.map((item) => (
                    <div key={item.id}><strong>v{item.version} · {item.label}</strong><span>{statusLabel(item.status)}</span><code>{item.quoteHash.slice(0, 12)}…</code></div>
                  ))}
                </section>
                {counterofferHistory.length ? (
                  <section className="deal-room-negotiation-history">
                    <p className="micro-label">Negotiation history</p>
                    <h2>Every ask, bounded</h2>
                    {counterofferHistory.map((counteroffer) => (
                      <article key={counteroffer.id}>
                        <div><strong>{formatMoney(counteroffer.targetUnitPaise)} target</strong><span>{statusLabel(counteroffer.status)}</span></div>
                        <p>{counteroffer.decisionSummary}</p>
                        <small>{counteroffer.reasonCodes.join(' · ').replaceAll('_', ' ')}</small>
                      </article>
                    ))}
                  </section>
                ) : null}
              </div>
            </details>
          </aside>
        </section>
      )}
    </main>
  );
}

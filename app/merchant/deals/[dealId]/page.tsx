import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import {
  loadDealQuotes,
  loadDealQuoteWorkspace,
} from '@/src/application/quote-workflow';
import { ApproveQuoteButton } from './approve-quote-button';

type DealPageProps = { params: Promise<{ dealId: string }> };

function formatMoney(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export async function generateMetadata({ params }: DealPageProps): Promise<Metadata> {
  const { dealId } = await params;
  return {
    title: `Deal ${dealId.slice(0, 8).toUpperCase()} — Boli`,
    description: 'A deterministic corporate-gifting quote workspace.',
    openGraph: { images: [] },
    twitter: { images: [] },
  };
}

export default async function MerchantDealPage({ params }: DealPageProps) {
  const { dealId } = await params;
  await ensureDatabase(env.DB);
  const workspace = await loadDealQuoteWorkspace(env.DB, dealId);
  if (!workspace) notFound();
  const { deal, result } = workspace;
  const quoteHistory = await loadDealQuotes(env.DB, dealId);
  const currentQuote = quoteHistory.find(
    (quote) => quote.status === 'buyer_accepted' || quote.status === 'merchant_approved',
  );
  const buyerAccepted = currentQuote?.status === 'buyer_accepted';

  return (
    <main className="quote-workspace">
      <header className="merchant-header quote-header">
        <Link className="wordmark" href="/">
          <span className="wordmark-stamp" aria-hidden="true">B</span>
          <span>Boli</span>
        </Link>
        <p className="quote-header-title">Quote laboratory · The Good Batch</p>
        <Link className="buyer-return" href="/merchant/deals">← Deal inbox</Link>
      </header>

      <section className="quote-layout">
        <aside className="quote-brief">
          <p className="eyebrow"><span aria-hidden="true">✦</span> Deal {deal.id.slice(0, 8)}</p>
          <h1>One brief.<br /><em>Three safe shapes.</em></h1>
          <blockquote>{deal.rawText}</blockquote>

          <dl className="brief-facts">
            <div><dt>Quantity</dt><dd>{deal.quantity} kits</dd></div>
            <div><dt>Hard cap</dt><dd>{formatMoney(deal.maxUnitPaise)} / kit</dd></div>
            <div><dt>Delivery</dt><dd>{deal.deliveryLocations.join(' · ')}</dd></div>
            <div><dt>Deadline</dt><dd>{deal.deadline}</dd></div>
          </dl>

          <div className="locked-list">
            <p>Locked by the buyer</p>
            {deal.hardConstraints.map((constraint) => (
              <span key={constraint}>✓ {constraint.replace('-', ' ')}</span>
            ))}
          </div>

          {deal.agentInterpretation ? (
            <div className="agent-trace">
              <span aria-hidden="true">✦</span>
              <p>
                <strong>Mistral interpretation attached</strong>
                {deal.agentInterpretation.model} · buyer {deal.agentInterpretation.reviewStatus} ·{' '}
                {deal.agentInterpretation.totalTokens.toLocaleString('en-IN')} tokens ·{' '}
                {deal.agentInterpretation.latencyMs.toLocaleString('en-IN')} ms
              </p>
            </div>
          ) : null}

          <div className="no-money-notice">
            <span aria-hidden="true">◇</span>
            <p>
              <strong>{currentQuote ? `Quote v${currentQuote.version} is ${currentQuote.status.replaceAll('_', ' ')}` : 'Preview only'}</strong>
              {currentQuote
                ? 'The quote contract exists, but no order or payment action has been created.'
                : 'No order, approval or payment action has been created.'}
            </p>
          </div>
        </aside>

        <section className="quote-results" aria-labelledby="quote-results-title">
          <div className="quote-results-heading">
            <div>
              <p className="micro-label">Deterministic quote engine</p>
              <h2 id="quote-results-title">
                {result.status === 'generated' ? 'Policy-safe options' : 'No safe quote yet'}
              </h2>
            </div>
            <span className="engine-stat">
              {result.evaluatedCombinations} combinations checked
            </span>
          </div>

          {result.status === 'rejected' ? (
            <div className="quote-rejection">
              <span aria-hidden="true">!</span>
              <div>
                <h3>Boli stopped here.</h3>
                {result.reasons.map((reason) => <p key={reason.code}>{reason.message}</p>)}
              </div>
            </div>
          ) : (
            <>
              {currentQuote ? (
                <div className="issued-quote-banner">
                  <div>
                    <span>{buyerAccepted ? 'Buyer accepted' : 'Buyer action required'}</span>
                    <p>Quote v{currentQuote.version} · {currentQuote.label} · fingerprint {currentQuote.quoteHash.slice(0, 12)}…</p>
                  </div>
                  <Link href={`/deal/${deal.publicToken}`}>
                    {buyerAccepted ? 'View acceptance receipt →' : 'Open buyer Deal Room →'}
                  </Link>
                </div>
              ) : null}
              <div className="quote-engine-note">
                <span>{result.feasibleCombinations} feasible</span>
                <p>Options are selected by explicit positions: lowest price, balanced use of budget, and richest kit under the cap.</p>
              </div>
              <div className="quote-option-list">
                {result.options.map((option, index) => (
                  <article className={`quote-option quote-option-${option.key}`} key={option.key}>
                    <div className="quote-option-index">0{index + 1}</div>
                    <div className="quote-option-main">
                      <div className="quote-option-heading">
                        <div>
                          <span>{option.label}</span>
                          <h3>{formatMoney(option.unitTotalPaise)} <small>/ kit</small></h3>
                        </div>
                        <div className="margin-seal">
                          <strong>{(option.contributionMarginBps / 100).toFixed(1)}%</strong>
                          <span>margin</span>
                        </div>
                      </div>
                      <p className="quote-rationale">{option.rationale}</p>

                      <div className="quote-products">
                        {option.lines.filter((line) => line.kind === 'product').map((line) => (
                          <div key={line.code}>
                            <span>{line.code}</span>
                            <p>{line.label}</p>
                            <strong>{formatMoney(line.unitPricePaise)}</strong>
                          </div>
                        ))}
                      </div>

                      <div className="quote-breakdown">
                        <div><span>Products</span><strong>{formatMoney(option.productUnitPaise)}</strong></div>
                        <div><span>Assembly, branding, delivery & reserve</span><strong>{formatMoney(option.serviceUnitPaise)}</strong></div>
                        <div><span>Headroom below buyer cap</span><strong>{formatMoney(option.headroomPaise)}</strong></div>
                        <div className="order-total"><span>Order total · {deal.quantity} kits</span><strong>{formatMoney(option.orderTotalPaise)}</strong></div>
                      </div>

                      <div className="quote-checks">
                        {option.checks.slice(0, 4).map((check) => (
                          <span key={check.code}>✓ {check.code.replaceAll('_', ' ').toLowerCase()}</span>
                        ))}
                      </div>

                      <ApproveQuoteButton
                        dealId={deal.id}
                        optionKey={option.key}
                        isCurrent={
                          currentQuote?.status === 'merchant_approved' &&
                          currentQuote.optionKey === option.key &&
                          currentQuote.unitTotalPaise === option.unitTotalPaise &&
                          currentQuote.orderTotalPaise === option.orderTotalPaise
                        }
                        disabled={buyerAccepted}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

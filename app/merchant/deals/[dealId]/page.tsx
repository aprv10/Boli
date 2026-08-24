import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { deals, products, purchaseIntents, purchaseRequirements } from '@/db/schema';
import { ensureDatabase, getDatabase } from '@/src/adapters/db/database';
import { generateCorporateGiftingQuotes } from '@/src/domain/quoting/corporate-gifting-engine';
import type { CatalogProduct, HardConstraint } from '@/src/domain/quoting/types';

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
  const db = getDatabase(env.DB);

  const [deal] = await db
    .select({
      id: deals.id,
      state: deals.state,
      createdAt: deals.createdAt,
      rawText: purchaseIntents.rawText,
      constraintsJson: purchaseIntents.constraintsJson,
      quantity: purchaseRequirements.quantity,
      maxUnitPaise: purchaseRequirements.maxUnitPaise,
      deliveryLocationsJson: purchaseRequirements.deliveryLocationsJson,
      deadline: purchaseRequirements.deadline,
    })
    .from(deals)
    .innerJoin(purchaseIntents, eq(deals.intentId, purchaseIntents.id))
    .innerJoin(
      purchaseRequirements,
      eq(purchaseIntents.id, purchaseRequirements.intentId),
    )
    .where(eq(deals.id, dealId))
    .limit(1);

  if (!deal) notFound();

  const catalogRows = await db
    .select()
    .from(products)
    .where(and(eq(products.merchantId, 'merchant-good-batch'), eq(products.active, true)));

  const catalog: CatalogProduct[] = catalogRows.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    tags: JSON.parse(product.tagsJson) as string[],
    unitPricePaise: product.unitPricePaise,
    unitCostPaise: product.unitCostPaise,
    availableQuantity: product.availableQuantity,
    leadTimeDays: product.leadTimeDays,
  }));
  const hardConstraints = JSON.parse(deal.constraintsJson) as HardConstraint[];
  const deliveryLocations = JSON.parse(deal.deliveryLocationsJson) as string[];
  const result = generateCorporateGiftingQuotes(catalog, {
    quantity: deal.quantity,
    maxUnitPaise: deal.maxUnitPaise,
    deliveryLocations,
    deadline: deal.deadline,
    hardConstraints,
  });

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
            <div><dt>Delivery</dt><dd>{deliveryLocations.join(' · ')}</dd></div>
            <div><dt>Deadline</dt><dd>{deal.deadline}</dd></div>
          </dl>

          <div className="locked-list">
            <p>Locked by the buyer</p>
            {hardConstraints.map((constraint) => (
              <span key={constraint}>✓ {constraint.replace('-', ' ')}</span>
            ))}
          </div>

          <div className="no-money-notice">
            <span aria-hidden="true">◇</span>
            <p><strong>Preview only</strong>No order, approval or payment action has been created.</p>
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

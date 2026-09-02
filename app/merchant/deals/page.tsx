import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { deals, purchaseIntents, purchaseRequirements } from '@/db/schema';
import { ensureDatabase, getDatabase } from '@/src/adapters/db/database';
import { DEMO_MERCHANT } from '@/src/adapters/db/seed-data';
import { ResetDemoButton } from './reset-demo-button';
import { SiteHeader } from '../../site-header';

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export default async function MerchantDealsPage() {
  await ensureDatabase(env.DB);
  const db = getDatabase(env.DB);
  const inbox = await db
    .select({
      id: deals.id,
      state: deals.state,
      createdAt: deals.createdAt,
      rawText: purchaseIntents.rawText,
      constraintsJson: purchaseIntents.constraintsJson,
      quantity: purchaseRequirements.quantity,
      maxUnitPaise: purchaseRequirements.maxUnitPaise,
      latestQuoteStatus: sql<string | null>`(
        SELECT status FROM quotes
        WHERE quotes.deal_id = ${deals.id}
        ORDER BY version DESC LIMIT 1
      )`,
    })
    .from(deals)
    .innerJoin(purchaseIntents, eq(deals.intentId, purchaseIntents.id))
    .innerJoin(purchaseRequirements, eq(purchaseIntents.id, purchaseRequirements.intentId))
    .where(eq(deals.merchantId, DEMO_MERCHANT.id))
    .orderBy(desc(deals.createdAt));

  return (
    <main className="merchant-shell">
      <SiteHeader active="merchant" context="The Good Batch · Merchant" />

      <section className="inbox-layout">
        <aside className="inbox-rail">
          <p className="eyebrow"><span aria-hidden="true">✦</span> Merchant workspace</p>
          <h1>Review and approve buyer deals.</h1>
          <p className="inbox-intro">
            Open a request, compare the safe quote options and approve the offer you want
            the buyer to see.
          </p>
          <dl className="inbox-stats">
            <div><dt>New requests</dt><dd>{inbox.length.toString().padStart(2, '0')}</dd></div>
            <div><dt>Catalogued items</dt><dd>20</dd></div>
          </dl>
        </aside>

        <section className="deal-inbox" aria-labelledby="inbox-title">
          <div className="inbox-heading">
            <div><p className="micro-label">Deal inbox</p><h2 id="inbox-title">Buyer requests</h2></div>
            <div className="inbox-tools">
              <ResetDemoButton />
              <span className="inbox-count">{inbox.length} total</span>
            </div>
          </div>

          {inbox.length === 0 ? (
            <div className="empty-inbox">
              <span aria-hidden="true">↳</span>
              <h3>The desk is clear.</h3>
              <p>Submit a request from the buyer desk and it will appear here.</p>
              <Link href="/request">Create the first request</Link>
            </div>
          ) : (
            <div className="deal-list">
              {inbox.map((deal, index) => {
                const constraints = JSON.parse(deal.constraintsJson) as string[];
                return (
                  <article className="deal-row" key={deal.id}>
                    <div className="deal-sequence">{String(inbox.length - index).padStart(2, '0')}</div>
                    <div className="deal-copy">
                      <div className="deal-meta">
                        <span className="new-badge">New brief</span>
                        <time dateTime={deal.createdAt}>{formatTime(deal.createdAt)}</time>
                      </div>
                      <p>{deal.rawText}</p>
                      <div className="deal-constraints">
                        <span>{deal.quantity} kits</span>
                        <span>₹{Math.round(deal.maxUnitPaise / 100).toLocaleString('en-IN')} max / kit</span>
                        {constraints.map((constraint) => <span key={constraint}>{constraint.replace('-', ' ')}</span>)}
                      </div>
                    </div>
                    <div className="deal-action">
                      <span>{deal.latestQuoteStatus?.replaceAll('_', ' ') ?? 'Intent received'}</span>
                      <Link className="shape-deal-link" href={`/merchant/deals/${deal.id}`}>
                        {deal.latestQuoteStatus ? 'Open deal →' : 'Shape request →'}
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

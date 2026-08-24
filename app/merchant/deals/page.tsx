import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { deals, purchaseIntents, purchaseRequirements } from '@/db/schema';
import { ensureDatabase, getDatabase } from '@/src/adapters/db/database';
import { DEMO_MERCHANT } from '@/src/adapters/db/seed-data';
import { ResetDemoButton } from './reset-demo-button';

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
    })
    .from(deals)
    .innerJoin(purchaseIntents, eq(deals.intentId, purchaseIntents.id))
    .innerJoin(purchaseRequirements, eq(purchaseIntents.id, purchaseRequirements.intentId))
    .where(eq(deals.merchantId, DEMO_MERCHANT.id))
    .orderBy(desc(deals.createdAt));

  return (
    <main className="merchant-shell">
      <header className="merchant-header">
        <Link className="wordmark" href="/">
          <span className="wordmark-stamp" aria-hidden="true">B</span>
          <span>Boli</span>
        </Link>
        <div className="merchant-header-center">
          <span className="merchant-monogram" aria-hidden="true">GB</span>
          <p><span>Merchant desk</span><strong>The Good Batch</strong></p>
        </div>
        <Link className="buyer-return" href="/">Open buyer desk ↗</Link>
      </header>

      <section className="inbox-layout">
        <aside className="inbox-rail">
          <p className="eyebrow"><span aria-hidden="true">✦</span> Live deal room</p>
          <h1>Requests worth answering.</h1>
          <p className="inbox-intro">
            Every brief arrives with the buyer’s original words intact. Boli will
            structure it next—without pretending ambiguity is certainty.
          </p>
          <dl className="inbox-stats">
            <div><dt>New requests</dt><dd>{inbox.length.toString().padStart(2, '0')}</dd></div>
            <div><dt>Catalogued items</dt><dd>20</dd></div>
          </dl>
        </aside>

        <section className="deal-inbox" aria-labelledby="inbox-title">
          <div className="inbox-heading">
            <div><p className="micro-label">Merchant inbox</p><h2 id="inbox-title">Unshaped requests</h2></div>
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
              <Link href="/">Create the first request</Link>
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
                      <span>Intent received</span>
                      <Link className="shape-deal-link" href={`/merchant/deals/${deal.id}`}>Shape request →</Link>
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

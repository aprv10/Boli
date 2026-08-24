import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/src/adapters/db/database';
import { loadPublicDealRoom } from '@/src/application/quote-workflow';
import { AcceptQuoteButton } from './accept-quote-button';

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

  const quote = room.currentQuote;
  const isExpired = quote
    ? Date.parse(quote.expiresAt) <= Date.parse(room.evaluatedAt)
    : false;
  const accepted = quote?.status === 'buyer_accepted';

  return (
    <main className="deal-room-shell">
      <header className="deal-room-header">
        <Link className="wordmark" href="/">
          <span className="wordmark-stamp" aria-hidden="true">B</span>
          <span>Boli</span>
        </Link>
        <p>Buyer Deal Room · The Good Batch</p>
        <Link href="/">← Buyer desk</Link>
      </header>

      <section className="deal-room-hero">
        <div>
          <p className="eyebrow"><span aria-hidden="true">✦</span> Executable quote contract</p>
          <h1>The exact deal.<br /><em>Nothing implied.</em></h1>
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

            <div className="executable-lines">
              {quote.lines.map((line) => (
                <div key={line.code}>
                  <span>{line.kind}</span>
                  <p>{line.label}</p>
                  <strong>{formatMoney(line.unitPricePaise)}</strong>
                </div>
              ))}
            </div>

            <dl className="executable-totals">
              <div><dt>Quantity</dt><dd>{quote.quantity}</dd></div>
              <div><dt>Merchant margin</dt><dd>{(quote.contributionMarginBps / 100).toFixed(1)}%</dd></div>
              <div><dt>Valid until</dt><dd>{formatMoment(quote.expiresAt)}</dd></div>
              <div className="executable-grand-total"><dt>Exact order total</dt><dd>{formatMoney(quote.orderTotalPaise)}</dd></div>
            </dl>

            <div className="quote-identity">
              <div>
                <span>Quote fingerprint · SHA-256</span>
                <code>{quote.quoteHash}</code>
              </div>
              <p>The merchant approval and your acceptance both point to this exact fingerprint.</p>
            </div>

            {isExpired && !accepted ? (
              <div className="deal-room-expired">
                <strong>Acceptance blocked</strong>
                This quote expired. The merchant must regenerate and approve a new version.
              </div>
            ) : (
              <AcceptQuoteButton
                publicToken={publicToken}
                disabled={isExpired}
                accepted={accepted}
              />
            )}
          </article>

          <aside className="deal-room-proof">
            <section>
              <p className="micro-label">Policy receipt</p>
              <h2>Why this is safe</h2>
              <div className="deal-room-checks">
                {quote.checks.map((check) => (
                  <div key={check.code}>
                    <span aria-hidden="true">✓</span>
                    <p><strong>{check.code.replaceAll('_', ' ').toLowerCase()}</strong>{check.observed} · required {check.required}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="deal-room-timeline">
              <p className="micro-label">Append-only activity</p>
              <h2>Decision trail</h2>
              {room.events.map((event) => (
                <article key={event.id}>
                  <span>{String(event.sequence).padStart(2, '0')}</span>
                  <div>
                    <p>{event.summary}</p>
                    <small>{event.actorType} · {formatMoment(event.createdAt)}</small>
                  </div>
                </article>
              ))}
            </section>

            <section className="quote-version-history">
              <p className="micro-label">Quote history</p>
              {room.quoteHistory.map((item) => (
                <div key={item.id}>
                  <strong>v{item.version} · {item.label}</strong>
                  <span>{statusLabel(item.status)}</span>
                  <code>{item.quoteHash.slice(0, 12)}…</code>
                </div>
              ))}
            </section>
          </aside>
        </section>
      )}
    </main>
  );
}

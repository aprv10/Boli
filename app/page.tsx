'use client';

import { useMemo, useState } from 'react';

const startingBrief =
  'I need 120 thoughtful welcome kits for our new team. Keep each kit under ₹900, make everything vegan and plastic-free, add our logo, and split delivery between Bengaluru and Pune by Friday.';

const constraintOptions = [
  { id: 'vegan', label: 'Vegan' },
  { id: 'plastic-free', label: 'Plastic-free' },
  { id: 'branded', label: 'Logo branding' },
  { id: 'multi-city', label: 'Multi-city' },
] as const;

export default function Home() {
  const [brief, setBrief] = useState(startingBrief);
  const [constraints, setConstraints] = useState<string[]>([
    'vegan',
    'plastic-free',
    'branded',
    'multi-city',
  ]);
  const [captured, setCaptured] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [dealReference, setDealReference] = useState('');

  const characterState = useMemo(() => {
    if (brief.length < 40) return 'A little more detail will help';
    if (brief.length < 120) return 'Good start — add delivery details';
    return 'Rich enough to shape into a buying brief';
  }, [brief.length]);

  function toggleConstraint(id: string) {
    setCaptured(false);
    setDealReference('');
    setConstraints((current) =>
      current.includes(id)
        ? current.filter((constraint) => constraint !== id)
        : [...current, id],
    );
  }

  async function submitBrief() {
    setSubmitting(true);
    setSubmitError('');
    setDealReference('');

    try {
      const response = await fetch('/api/intents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawText: brief, hardConstraints: constraints }),
      });
      const result = (await response.json()) as {
        deal?: { id: string };
        error?: { message?: string };
      };

      if (!response.ok || !result.deal) {
        throw new Error(result.error?.message ?? 'The request could not be saved.');
      }

      setCaptured(true);
      setDealReference(result.deal.id.slice(0, 8).toUpperCase());
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The request could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="boli-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Boli home">
          <span className="wordmark-stamp" aria-hidden="true">B</span>
          <span>Boli</span>
        </a>

        <nav className="topnav" aria-label="Primary navigation">
          <a className="nav-link nav-link-active" href="#request">Buyer desk</a>
          <a className="nav-link" href="#merchant-preview">Merchant gate</a>
        </nav>

        <div className="merchant-presence">
          <span className="presence-dot" aria-hidden="true" />
          The Good Batch is online
        </div>
      </header>

      <section className="request-stage" id="top">
        <div className="stage-index" aria-hidden="true">
          <span>RFQ</span><strong>001</strong><span className="index-rule" /><span>INR</span>
        </div>

        <section className="intro-panel">
          <p className="eyebrow"><span aria-hidden="true">✦</span> Agentic quote desk</p>
          <h1>Say what you need.<br /><em>Boli makes it a deal.</em></h1>
          <p className="intro-copy">
            Turn a messy bulk-buying request into a constrained, negotiable and
            payable order—without losing the human judgment that matters.
          </p>

          <div className="trust-stack" aria-label="Boli safeguards">
            <div><span>01</span><p><strong>Budget stays bounded</strong>Boli cannot spend above your mandate.</p></div>
            <div><span>02</span><p><strong>Constraints stay explicit</strong>Nothing important is silently substituted.</p></div>
            <div><span>03</span><p><strong>Money stays gated</strong>You see and accept the exact payable quote.</p></div>
          </div>
        </section>

        <section className="brief-panel" id="request" aria-labelledby="brief-title">
          <div className="brief-card">
            <div className="brief-heading">
              <div><p className="micro-label">Your request</p><h2 id="brief-title">Start with the messy version.</h2></div>
              <span className="draft-pill">Draft</span>
            </div>

            <label className="sr-only" htmlFor="purchase-brief">Describe what you want to purchase</label>
            <textarea
              id="purchase-brief"
              maxLength={600}
              value={brief}
              onChange={(event) => { setBrief(event.target.value); setCaptured(false); setDealReference(''); }}
              placeholder="Tell Boli what you need, how many, your budget and what cannot change…"
            />

            <div className="brief-health">
              <span className="health-dot" aria-hidden="true" />
              {characterState}
              <span className="character-count">{brief.length}/600</span>
            </div>

            <div className="constraint-block">
              <p>What must not change?</p>
              <div className="constraint-list">
                {constraintOptions.map((option) => {
                  const active = constraints.includes(option.id);
                  return (
                    <button className={`constraint-chip ${active ? 'constraint-chip-active' : ''}`} key={option.id} type="button" aria-pressed={active} onClick={() => toggleConstraint(option.id)}>
                      <span aria-hidden="true">{active ? '✓' : '+'}</span>{option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button className="shape-button" type="button" disabled={brief.trim().length < 40 || submitting} onClick={submitBrief}>
              <span>{submitting ? 'Opening the deal…' : captured ? 'Brief captured' : 'Shape my request'}</span>
              <span className="button-arrow" aria-hidden="true">{submitting ? '···' : captured ? '✓' : '↗'}</span>
            </button>

            <p className={`capture-note ${captured ? 'capture-note-visible' : ''}`} role="status">
              Saved as BOLI / {dealReference}. <a href="/merchant/deals">See it arrive at the merchant desk →</a>
            </p>
            {submitError ? <p className="submit-error" role="alert">{submitError}</p> : null}
          </div>

          <div className="merchant-ribbon" id="merchant-preview">
            <span className="merchant-monogram" aria-hidden="true">GB</span>
            <p><span>Buying from</span><strong>The Good Batch</strong></p>
            <div className="merchant-meta"><span>20 products</span><span>2-day quote SLA</span></div>
          </div>
        </section>

        <aside className="mandate-panel" aria-label="Live buying mandate">
          <div className="mandate-ticket">
            <div className="ticket-topline"><span>LIVE MANDATE</span><span>BOLI / 001</span></div>
            <p className="ticket-kicker">Boli heard</p>
            <h2>Employee welcome kits</h2>

            <dl className="mandate-grid">
              <div><dt>Quantity</dt><dd>120</dd></div>
              <div><dt>Max / kit</dt><dd>₹900</dd></div>
              <div><dt>Deliver to</dt><dd>2 cities</dd></div>
              <div><dt>Needed by</dt><dd>Friday</dd></div>
            </dl>

            <div className="mandate-constraints">
              <p>Locked constraints</p>
              {constraints.length ? (
                <ul>
                  {constraintOptions.filter((option) => constraints.includes(option.id)).map((option) => (
                    <li key={option.id}><span aria-hidden="true">↳</span> {option.label}</li>
                  ))}
                </ul>
              ) : <span className="empty-constraints">Nothing locked yet</span>}
            </div>

            <div className="mandate-footer">
              <span className="lock-mark" aria-hidden="true">◇</span>
              <p><strong>No payment authority yet</strong>Your mandate stays a draft until you approve it.</p>
            </div>
          </div>
          <p className="ticket-caption">The card updates as your request becomes more precise.</p>
        </aside>
      </section>

      <footer className="stage-footer">
        <span>Boli turns intent into accountable commerce.</span>
        <span>Built for humans · Readable by agents</span>
      </footer>
    </main>
  );
}

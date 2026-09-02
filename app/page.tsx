import Link from 'next/link';
import { SiteHeader } from './site-header';

const journey = [
  {
    number: '01',
    title: 'Describe the need',
    copy: 'Tell Boli the quantity, budget, deadline and anything that must not change.',
  },
  {
    number: '02',
    title: 'Merchant approves',
    copy: 'Boli builds safe options. The merchant approves one exact, payable quote.',
  },
  {
    number: '03',
    title: 'Buyer decides',
    copy: 'Review the final bundle, accept it and create checkout only when you are ready.',
  },
];

export default function LandingPage() {
  return (
    <main className="landing-shell">
      <SiteHeader />

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow"><span aria-hidden="true">✦</span> Quote-to-order commerce</p>
          <h1>Bulk buying,<br /><em>without the back-and-forth.</em></h1>
          <p className="landing-lede">
            Boli turns a detailed buying request into a merchant-approved quote that is clear,
            negotiable and ready to pay.
          </p>
          <div className="landing-actions">
            <Link className="landing-primary" href="/request">Start a buying request <span>→</span></Link>
            <Link className="landing-secondary" href="/agent">Watch the AI buyer demo</Link>
          </div>
          <p className="landing-reassurance">No payment happens until the buyer accepts an exact quote.</p>
        </div>

        <div className="deal-story" aria-label="Example Boli journey">
          <article className="story-brief">
            <span>BUYER REQUEST</span>
            <p>“120 vegan welcome kits under ₹900, branded and delivered to two cities.”</p>
          </article>
          <div className="story-route" aria-hidden="true"><span>↓</span><b>BOLI SHAPES THE DEAL</b></div>
          <article className="story-quote">
            <header><span>READY FOR REVIEW</span><strong>₹842 / kit</strong></header>
            <div className="story-items">
              <span>Drinkware</span><span>Stationery</span><span>Vegan snack</span><span>Branding</span>
            </div>
            <footer><span>✓ Budget safe</span><span>✓ Constraints kept</span></footer>
          </article>
        </div>
      </section>

      <section className="landing-journey" id="how-it-works" aria-labelledby="journey-title">
        <div className="section-heading">
          <p className="micro-label">How it works</p>
          <h2 id="journey-title">One deal. Three clear decisions.</h2>
        </div>
        <div className="journey-grid">
          {journey.map((step) => (
            <article key={step.number}>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="role-entry" aria-labelledby="role-title">
        <div className="section-heading role-heading">
          <p className="micro-label">Choose a view</p>
          <h2 id="role-title">What would you like to do?</h2>
        </div>
        <div className="role-grid">
          <Link href="/request" className="role-card role-card-buyer">
            <span>BUYER</span>
            <h3>Request a bulk quote</h3>
            <p>Describe what you need and lock the requirements that matter.</p>
            <strong>Start buying →</strong>
          </Link>
          <Link href="/agent" className="role-card role-card-agent">
            <span>AI DEMO</span>
            <h3>See an agent buy safely</h3>
            <p>Watch an AI buyer compare options and pause for human approval.</p>
            <strong>Run the demo →</strong>
          </Link>
          <Link href="/merchant/deals" className="role-card role-card-merchant">
            <span>MERCHANT</span>
            <h3>Review incoming deals</h3>
            <p>Turn buyer requests into policy-safe quotes and approve the final offer.</p>
            <strong>Open workspace →</strong>
          </Link>
        </div>
      </section>

      <section className="landing-trust">
        <p><strong>Budget protected.</strong> The final price cannot exceed the buyer’s mandate.</p>
        <p><strong>Requirements preserved.</strong> Hard constraints are never silently relaxed.</p>
        <p><strong>Payment gated.</strong> Only a verified payment event marks a deal paid.</p>
      </section>

      <footer className="landing-footer">
        <span>Boli turns intent into accountable commerce.</span>
        <Link href="/request">Start with a request →</Link>
      </footer>
    </main>
  );
}

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '../site-header';

const startingBrief =
  'I need 120 thoughtful welcome kits for our new team. Keep each kit under ₹900, make everything vegan and plastic-free, add our logo, and split delivery between Bengaluru and Pune by Friday.';

const constraintOptions = [
  { id: 'vegan', label: 'Vegan' },
  { id: 'plastic-free', label: 'Plastic-free' },
  { id: 'branded', label: 'Logo branding' },
  { id: 'multi-city', label: 'Multi-city' },
] as const;

type Interpretation = {
  requestTitle: string;
  quantity: number | null;
  budgetKind: 'per_unit' | 'total' | 'unknown';
  budgetInr: number | null;
  deliveryLocations: string[];
  deadline: string | null;
  hardConstraints: string[];
  missingFields: string[];
  clarifyingQuestion: string | null;
};

type InterpretationResponse = {
  runId?: string;
  model?: string;
  interpretation?: Interpretation;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs?: number;
  error?: { message?: string };
};

function getNextFriday() {
  const date = new Date();
  const daysUntilFriday = (5 - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilFriday);
  return date.toISOString().slice(0, 10);
}

export default function BuyerRequestPage() {
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
  const [quantity, setQuantity] = useState(120);
  const [maxPerKit, setMaxPerKit] = useState(900);
  const [deliveryLocations, setDeliveryLocations] = useState('Bengaluru, Pune');
  const [deadline, setDeadline] = useState(getNextFriday);
  const [interpreting, setInterpreting] = useState(false);
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [interpretationMeta, setInterpretationMeta] = useState<{
    model: string;
    totalTokens: number;
    latencyMs: number;
  } | null>(null);
  const [interpretError, setInterpretError] = useState('');
  const [agentRunId, setAgentRunId] = useState('');
  const [agentDraftEdited, setAgentDraftEdited] = useState(false);

  const characterState = useMemo(() => {
    if (brief.length < 40) return 'A little more detail will help';
    if (brief.length < 120) return 'Good start — add delivery details';
    return 'Rich enough to shape into a buying brief';
  }, [brief.length]);

  function toggleConstraint(id: string) {
    setCaptured(false);
    setDealReference('');
    if (agentRunId) setAgentDraftEdited(true);
    setConstraints((current) =>
      current.includes(id)
        ? current.filter((constraint) => constraint !== id)
        : [...current, id],
    );
  }

  function markRailEdited() {
    setCaptured(false);
    if (agentRunId) setAgentDraftEdited(true);
  }

  function clearInterpretation() {
    setInterpretation(null);
    setInterpretationMeta(null);
    setInterpretError('');
    setAgentRunId('');
    setAgentDraftEdited(false);
  }

  async function interpretBrief() {
    setInterpreting(true);
    setInterpretError('');
    setCaptured(false);
    setDealReference('');

    try {
      const response = await fetch('/api/agent/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      const result = (await response.json()) as InterpretationResponse;
      if (!response.ok || !result.interpretation || !result.runId) {
        throw new Error(result.error?.message ?? 'Boli could not interpret this request.');
      }

      const draft = result.interpretation;
      if (draft.quantity !== null) setQuantity(draft.quantity);
      if (draft.budgetKind === 'per_unit' && draft.budgetInr !== null) {
        setMaxPerKit(Math.round(draft.budgetInr));
      }
      if (draft.deliveryLocations.length) {
        setDeliveryLocations(draft.deliveryLocations.join(', '));
      }
      if (draft.deadline) setDeadline(draft.deadline);
      setConstraints(draft.hardConstraints);
      setInterpretation(draft);
      setInterpretationMeta({
        model: result.model ?? 'mistral-small-2603',
        totalTokens: result.usage?.totalTokens ?? 0,
        latencyMs: result.latencyMs ?? 0,
      });
      setAgentRunId(result.runId);
      setAgentDraftEdited(false);
    } catch (error) {
      setInterpretError(
        error instanceof Error ? error.message : 'Boli could not interpret this request.',
      );
    } finally {
      setInterpreting(false);
    }
  }

  async function submitBrief() {
    setSubmitting(true);
    setSubmitError('');
    setDealReference('');

    try {
      const response = await fetch('/api/intents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rawText: brief,
          hardConstraints: constraints,
          quantity,
          maxUnitPaise: maxPerKit * 100,
          deliveryLocations: deliveryLocations
            .split(',')
            .map((location) => location.trim())
            .filter(Boolean),
          deadline,
          ...(agentRunId
            ? {
                agentRunId,
                agentReviewStatus: agentDraftEdited ? 'modified' : 'confirmed',
              }
            : {}),
        }),
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
    <main className="buyer-shell">
      <SiteHeader active="buyer" context="Viewing as buyer" />

      <section className="buyer-intro">
        <p className="eyebrow"><span aria-hidden="true">✦</span> Buyer workspace</p>
        <h1>What are you<br /><em>looking to buy?</em></h1>
        <p>Describe the order in your own words. Boli will turn it into a clear request for the merchant.</p>
      </section>

      <section className="buyer-request-layout" aria-labelledby="brief-title">
        <article className="buyer-form-card">
          <div className="brief-heading">
            <div><p className="micro-label">Step 1 of 3</p><h2 id="brief-title">Describe your request</h2></div>
            <span className="draft-pill">Draft</span>
          </div>

          <label className="buyer-field-label" htmlFor="purchase-brief">What do you need?</label>
          <textarea
            id="purchase-brief"
            maxLength={600}
            value={brief}
            onChange={(event) => {
              setBrief(event.target.value);
              setCaptured(false);
              setDealReference('');
              clearInterpretation();
            }}
            placeholder="For example: 120 welcome kits under ₹900 each, delivered to Bengaluru and Pune…"
          />
          <div className="brief-health">
            <span className="health-dot" aria-hidden="true" />
            {characterState}
            <span className="character-count">{brief.length}/600</span>
          </div>

          <div className="ai-read-row buyer-ai-helper">
            <button type="button" disabled={brief.trim().length < 40 || interpreting || submitting} onClick={interpretBrief}>
              <span aria-hidden="true">✦</span>
              {interpreting ? 'Reading your request…' : 'Fill the details from my description'}
            </button>
            <span>Optional AI assist</span>
          </div>

          {interpretation ? (
            <div className="ai-draft" role="status">
              <div><span>Review the suggested details</span><strong>{interpretation.requestTitle}</strong></div>
              <p>Boli filled the fields below. You can change anything before submitting.</p>
              {interpretation.clarifyingQuestion ? <p className="ai-draft-question">↳ {interpretation.clarifyingQuestion}</p> : null}
              <details>
                <summary>AI reading details</summary>
                <footer>
                  <span>{interpretationMeta?.model}</span>
                  <span>{interpretationMeta?.totalTokens.toLocaleString('en-IN')} tokens</span>
                  <span>{interpretationMeta?.latencyMs.toLocaleString('en-IN')} ms</span>
                  <span>{agentDraftEdited ? 'you edited it' : 'ready to review'}</span>
                </footer>
              </details>
            </div>
          ) : null}
          {interpretError ? <p className="ai-read-error" role="alert">{interpretError}</p> : null}

          <fieldset className="buyer-essentials">
            <legend>Order essentials</legend>
            <label>
              <span>How many kits?</span>
              <input type="number" min="10" max="10000" value={quantity} onChange={(event) => { setQuantity(Number(event.target.value)); markRailEdited(); }} />
            </label>
            <label>
              <span>Maximum per kit</span>
              <div className="money-input"><b>₹</b><input type="number" min="100" max="100000" value={maxPerKit} onChange={(event) => { setMaxPerKit(Number(event.target.value)); markRailEdited(); }} /></div>
            </label>
          </fieldset>

          <details className="buyer-more" open>
            <summary>Delivery and must-haves <span>Review</span></summary>
            <div className="buyer-more-grid">
              <label className="location-input"><span>Deliver to</span><input type="text" value={deliveryLocations} onChange={(event) => { setDeliveryLocations(event.target.value); markRailEdited(); }} /></label>
              <label><span>Needed by</span><input type="date" value={deadline} onChange={(event) => { setDeadline(event.target.value); markRailEdited(); }} /></label>
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
          </details>

          <button className="shape-button" type="button" disabled={captured || brief.trim().length < 40 || quantity < 10 || maxPerKit < 100 || !deliveryLocations.trim() || !deadline || submitting || interpreting} onClick={submitBrief}>
            <span>{submitting ? 'Sending your request…' : captured ? 'Request sent' : 'Send request to merchant'}</span>
            <span className="button-arrow" aria-hidden="true">{submitting ? '···' : captured ? '✓' : '→'}</span>
          </button>
          {captured ? (
            <div className="buyer-success" role="status">
              <div><strong>Request sent</strong><span>BOLI / {dealReference}</span></div>
              <p>The merchant can now review it and approve a quote.</p>
              <Link href="/merchant/deals">Continue to merchant workspace →</Link>
            </div>
          ) : null}
          {submitError ? <p className="submit-error" role="alert">{submitError}</p> : null}
        </article>

        <aside className="buyer-next-card">
          <span className="merchant-monogram" aria-hidden="true">GB</span>
          <p className="micro-label">Buying from</p>
          <h2>The Good Batch</h2>
          <p>After you send this request:</p>
          <ol>
            <li><span>1</span><p><strong>The merchant reviews it</strong>Your requirements stay attached.</p></li>
            <li><span>2</span><p><strong>You receive one clear quote</strong>Nothing is charged yet.</p></li>
            <li><span>3</span><p><strong>You decide whether to pay</strong>Checkout is always a separate step.</p></li>
          </ol>
        </aside>
      </section>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useState } from 'react';
import './agent.css';
import { SiteHeader } from '../site-header';

const initialBrief =
  'Buy 120 vegan, plastic-free welcome kits below ₹900 each, add our logo, split delivery between Bengaluru and Pune, and deliver by Friday.';

type Interpretation = {
  requestTitle: string;
  quantity: number | null;
  budgetKind: 'per_unit' | 'total' | 'unknown';
  budgetInr: number | null;
  deliveryLocations: string[];
  deadline: string | null;
  hardConstraints: Array<'vegan' | 'plastic-free' | 'branded' | 'multi-city'>;
  missingFields: string[];
  clarifyingQuestion: string | null;
};

type Mandate = {
  rawText: string;
  quantity: number;
  maxUnitPaise: number;
  deliveryLocations: string[];
  deadline: string;
  hardConstraints: Interpretation['hardConstraints'];
  agentRunId?: string;
};

type AgentStep = {
  tool: string;
  status: 'completed' | 'waiting' | 'blocked';
  title: string;
  summary: string;
};

type AgentRun = {
  runId: string;
  stage: string;
  deal: { id: string; dealRoomPath: string };
  recommendedOption?: {
    label: string;
    unitTotalPaise: number;
    orderTotalPaise: number;
  } | null;
  acceptedQuote?: {
    version: number;
    quoteHash: string;
    unitTotalPaise: number;
    orderTotalPaise: number;
    status: string;
  };
  audit?: { verified: boolean; headHash: string };
  steps: AgentStep[];
  resumeInstruction: string | null;
};

function nextFriday() {
  const date = new Date();
  const offset = (5 - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function money(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export default function AgentBuyerPage() {
  const [brief, setBrief] = useState(initialBrief);
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSource, setDraftSource] = useState('');
  const [run, setRun] = useState<AgentRun | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  async function letAgentRead() {
    setWorking(true);
    setError('');
    setMandate(null);
    setRun(null);
    try {
      const response = await fetch('/api/agent/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      const result = (await response.json()) as {
        runId?: string;
        model?: string;
        interpretation?: Interpretation;
        usage?: { totalTokens: number };
        error?: { message?: string };
      };
      if (!response.ok || !result.interpretation || !result.runId) {
        throw new Error(result.error?.message ?? 'The agent could not interpret this mandate.');
      }
      const draft = result.interpretation;
      const complete =
        draft.quantity !== null &&
        draft.budgetKind === 'per_unit' &&
        draft.budgetInr !== null &&
        draft.deliveryLocations.length > 0 &&
        draft.deadline !== null &&
        draft.missingFields.length === 0;
      if (!complete) {
        throw new Error(
          draft.clarifyingQuestion ??
            'The agent needs quantity, per-kit budget, delivery locations and deadline before it can act.',
        );
      }
      setMandate({
        rawText: brief,
        quantity: draft.quantity!,
        maxUnitPaise: Math.round(draft.budgetInr! * 100),
        deliveryLocations: draft.deliveryLocations,
        deadline: draft.deadline!,
        hardConstraints: draft.hardConstraints,
        agentRunId: result.runId,
      });
      setDraftTitle(draft.requestTitle);
      setDraftSource(`${result.model ?? 'Mistral'} · ${result.usage?.totalTokens ?? 0} tokens`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The mandate could not be interpreted.');
    } finally {
      setWorking(false);
    }
  }

  function loadToolDemo() {
    setError('');
    setRun(null);
    setMandate({
      rawText: brief,
      quantity: 120,
      maxUnitPaise: 90_000,
      deliveryLocations: ['Bengaluru', 'Pune'],
      deadline: nextFriday(),
      hardConstraints: ['vegan', 'plastic-free', 'branded', 'multi-city'],
    });
    setDraftTitle('Employee welcome kits');
    setDraftSource('Deterministic test mandate · no LLM call');
  }

  async function dispatchAgent() {
    if (!mandate) return;
    setWorking(true);
    setError('');
    try {
      const response = await fetch('/api/agent/v1/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'start', mandate }),
      });
      const result = (await response.json()) as AgentRun & { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'The buyer agent stopped.');
      setRun(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The buyer agent stopped.');
    } finally {
      setWorking(false);
    }
  }

  async function resumeAgent() {
    if (!run) return;
    setWorking(true);
    setError('');
    try {
      const response = await fetch('/api/agent/v1/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'resume', dealId: run.deal.id }),
      });
      const result = (await response.json()) as AgentRun & { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'The buyer agent could not resume.');
      setRun(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The buyer agent could not resume.');
    } finally {
      setWorking(false);
    }
  }

  const accepted = run?.stage === 'accepted_waiting_for_checkout';

  return (
    <main className="agent-surface">
      <SiteHeader active="agent" context="Viewing as AI buyer" />

      <section className="agent-intro">
        <p><span>✦</span> Guided AI buyer demo</p>
        <h1>Watch an AI buyer<br /><em>build a deal safely.</em></h1>
        <p className="agent-intro-copy">
          Give the agent a buying request. It will compare safe options, then pause when a
          merchant decision is required.
        </p>
        <div>
          <strong>01</strong><span>Understand<br />the request</span>
          <strong>02</strong><span>Compare<br />safe options</span>
          <strong>03</strong><span>Pause for<br />human approval</span>
        </div>
      </section>

      <section className="agent-workbench">
        <article className="agent-command-card">
          <div className="agent-card-heading">
            <div><span>STEP 1 · BUYING REQUEST</span><h2>What should the agent buy?</h2></div>
            <b>{run ? run.stage.replaceAll('_', ' ') : mandate ? 'review' : 'draft'}</b>
          </div>
          <label htmlFor="agent-brief">Describe the order</label>
          <textarea
            id="agent-brief"
            value={brief}
            maxLength={600}
            disabled={Boolean(run)}
            onChange={(event) => {
              setBrief(event.target.value);
              setMandate(null);
              setRun(null);
              setError('');
            }}
          />

          {!mandate ? (
            <div className="agent-read-actions">
              <button type="button" onClick={letAgentRead} disabled={working || brief.length < 40}>
                {working ? 'Reading request…' : 'Read my request with AI →'}
              </button>
              <button type="button" onClick={loadToolDemo} disabled={working}>
                Use the ready-made example
              </button>
            </div>
          ) : null}

          {mandate ? (
            <section className="agent-mandate-receipt">
              <header><span>Buyer confirmation required</span><strong>{draftTitle}</strong><small>{draftSource}</small></header>
              <dl>
                <div><dt>Quantity</dt><dd>{mandate.quantity}</dd></div>
                <div><dt>Maximum / kit</dt><dd>{money(mandate.maxUnitPaise)}</dd></div>
                <div><dt>Delivery</dt><dd>{mandate.deliveryLocations.join(' · ')}</dd></div>
                <div><dt>Deadline</dt><dd>{mandate.deadline}</dd></div>
              </dl>
              <div className="agent-constraint-row">
                {mandate.hardConstraints.map((constraint) => <span key={constraint}>◇ {constraint}</span>)}
              </div>
              {!run ? (
                <button type="button" onClick={dispatchAgent} disabled={working}>
                  {working ? 'Dispatching tools…' : 'Confirm mandate & dispatch agent →'}
                </button>
              ) : null}
            </section>
          ) : null}
          {error ? <p className="agent-console-error" role="alert">{error}</p> : null}
        </article>

        <aside className="agent-execution-rail">
          <header>
            <div><span className="agent-live-dot" /> LIVE EXECUTION</div>
            <code>{run ? run.runId.slice(0, 8).toUpperCase() : 'NOT STARTED'}</code>
          </header>
          {!run ? (
            <div className="agent-empty-run">
              <span>↳</span>
              <h2>The demo has not started.</h2>
              <p>Choose the ready-made example or let AI read your own request. Each completed step will appear here.</p>
            </div>
          ) : (
            <>
              <div className="agent-step-list">
                {run.steps.map((step, index) => (
                  <article className={`agent-step agent-step-${step.status}`} key={`${step.tool}-${index}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <code>{step.tool}</code>
                      <h3>{step.title}</h3>
                      <p>{step.summary}</p>
                    </div>
                    <b>{step.status}</b>
                  </article>
                ))}
              </div>

              {run.stage === 'awaiting_merchant_approval' ? (
                <section className="agent-human-gate">
                  <span>Human-in-the-loop checkpoint</span>
                  <h2>The agent has stopped itself.</h2>
                  {run.recommendedOption ? (
                    <p>
                      Recommendation: <strong>{run.recommendedOption.label}</strong> at{' '}
                      <strong>{money(run.recommendedOption.unitTotalPaise)} per kit</strong>.
                    </p>
                  ) : null}
                  <div>
                    <a href={`/merchant/deals/${run.deal.id}`} target="_blank" rel="noreferrer">
                      Open merchant gate ↗
                    </a>
                    <button type="button" onClick={resumeAgent} disabled={working}>
                      {working ? 'Checking approval…' : 'Resume & accept within mandate →'}
                    </button>
                  </div>
                </section>
              ) : null}

              {accepted && run.acceptedQuote ? (
                <section className="agent-accepted-receipt">
                  <div><span>✓</span><p><strong>Executable quote accepted</strong>Payment authority was not granted.</p></div>
                  <dl>
                    <div><dt>Quote</dt><dd>v{run.acceptedQuote.version}</dd></div>
                    <div><dt>Per kit</dt><dd>{money(run.acceptedQuote.unitTotalPaise)}</dd></div>
                    <div><dt>Order</dt><dd>{money(run.acceptedQuote.orderTotalPaise)}</dd></div>
                  </dl>
                  <code>{run.acceptedQuote.quoteHash}</code>
                  <p className="agent-audit-result">
                    {run.audit?.verified ? '◇ Audit chain verified' : 'Audit verification warning'}
                    <span>{run.audit?.headHash.slice(0, 14)}…</span>
                  </p>
                  <Link href={run.deal.dealRoomPath}>Open the human-readable Deal Room →</Link>
                </section>
              ) : null}
            </>
          )}
        </aside>
      </section>
      <details className="agent-developer-details">
        <summary>Developer details</summary>
        <a href="/.well-known/boli-commerce" target="_blank" rel="noreferrer">View the commerce manifest ↗</a>
      </details>
    </main>
  );
}

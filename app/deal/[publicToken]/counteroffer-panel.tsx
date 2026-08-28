'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type CounterofferPanelProps = {
  publicToken: string;
  quoteHash: string;
  currentUnitPaise: number;
  hardConstraints: string[];
  disabled: boolean;
};

type CounterofferResult = {
  status: string;
  proposedUnitPaise: number | null;
  summary: string;
  reasonCodes: string[];
};

function formatMoney(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function CounterofferPanel({
  publicToken,
  quoteHash,
  currentUnitPaise,
  hardConstraints,
  disabled,
}: CounterofferPanelProps) {
  const router = useRouter();
  const currentInr = Math.round(currentUnitPaise / 100);
  const [targetInr, setTargetInr] = useState(
    String(Math.max(100, currentInr - 50)),
  );
  const [message, setMessage] = useState(
    'Please find the strongest lower-priced kit without changing our locked requirements.',
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CounterofferResult | null>(null);
  const [error, setError] = useState('');

  async function submit() {
    const parsedTarget = Number(targetInr);
    if (!Number.isSafeInteger(parsedTarget) || parsedTarget < 100) {
      setError('Enter a whole-rupee target of at least ₹100.');
      return;
    }
    if (parsedTarget >= currentInr) {
      setError(`Your target must be below the current ₹${currentInr} per kit.`);
      return;
    }

    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch(
        `/api/public/deals/${publicToken}/counteroffers`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedQuoteHash: quoteHash,
            targetUnitPaise: parsedTarget * 100,
            buyerMessage: message,
          }),
        },
      );
      const body = (await response.json()) as {
        counteroffer?: CounterofferResult;
        error?: { message?: string };
      };
      if (!response.ok || !body.counteroffer) {
        throw new Error(body.error?.message ?? 'Boli could not evaluate that proposal.');
      }
      setResult(body.counteroffer);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Boli could not evaluate that proposal.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="counteroffer-console" aria-labelledby="counteroffer-title">
      <div className="counteroffer-console-heading">
        <div>
          <span>Bounded negotiation</span>
          <h3 id="counteroffer-title">Ask Boli for a better shape.</h3>
        </div>
        <strong>₹ only after policy</strong>
      </div>

      <p className="counteroffer-intro">
        Choose a target. Boli may change the kit composition, but it cannot relax
        your locked requirements or cross the merchant’s safety boundaries.
      </p>

      <div className="counteroffer-locked" aria-label="Protected requirements">
        <span>Never negotiable</span>
        {hardConstraints.length ? (
          hardConstraints.map((constraint) => (
            <strong key={constraint}>✓ {constraint.replace('-', ' ')}</strong>
          ))
        ) : (
          <strong>Original mandate</strong>
        )}
      </div>

      <div className="counteroffer-fields">
        <label>
          <span>Target per kit</span>
          <div className="money-field">
            <b>₹</b>
            <input
              inputMode="numeric"
              min="100"
              max={currentInr - 1}
              step="1"
              value={targetInr}
              onChange={(event) => setTargetInr(event.target.value)}
              disabled={disabled || submitting}
              aria-label="Target price per kit in rupees"
            />
          </div>
        </label>
        <label>
          <span>Buyer note</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            minLength={8}
            maxLength={280}
            disabled={disabled || submitting}
          />
        </label>
      </div>

      <button
        type="button"
        className="counteroffer-submit"
        disabled={disabled || submitting || message.trim().length < 8}
        onClick={submit}
      >
        {submitting ? 'Running price + policy checks…' : 'Evaluate counteroffer →'}
      </button>

      {result ? (
        <div className={`counteroffer-result counteroffer-result-${result.status}`} role="status">
          <span>{result.status.replaceAll('_', ' ')}</span>
          <p>{result.summary}</p>
          {result.proposedUnitPaise ? (
            <strong>Proposed: {formatMoney(result.proposedUnitPaise)} / kit</strong>
          ) : null}
          <small>{result.reasonCodes.join(' · ').replaceAll('_', ' ')}</small>
        </div>
      ) : null}
      {error ? <p className="counteroffer-error" role="alert">{error}</p> : null}
    </section>
  );
}

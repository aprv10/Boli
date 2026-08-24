'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type AcceptQuoteButtonProps = {
  publicToken: string;
  disabled: boolean;
  accepted: boolean;
};

export function AcceptQuoteButton({
  publicToken,
  disabled,
  accepted,
}: AcceptQuoteButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function accept() {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/public/deals/${publicToken}/accept`, {
        method: 'POST',
      });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'The quote was not accepted.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The quote was not accepted.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="deal-room-accept">
      <button type="button" disabled={disabled || submitting || accepted} onClick={accept}>
        {accepted
          ? 'Exact quote accepted ✓'
          : submitting
            ? 'Verifying quote hash…'
            : 'Accept this exact quote →'}
      </button>
      <p>
        This accepts quote terms only. Checkout remains a separate, explicit money gate.
      </p>
      {error ? <p className="deal-room-error" role="alert">{error}</p> : null}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { QuoteOption } from '@/src/domain/quoting/types';

type ApproveQuoteButtonProps = {
  dealId: string;
  optionKey: QuoteOption['key'];
  isCurrent: boolean;
  disabled: boolean;
};

export function ApproveQuoteButton({
  dealId,
  optionKey,
  isCurrent,
  disabled,
}: ApproveQuoteButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function approve() {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/deals/${dealId}/quotes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ optionKey }),
      });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'The quote was not approved.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The quote was not approved.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="quote-approval-control">
      <button
        type="button"
        disabled={disabled || submitting || isCurrent}
        onClick={approve}
      >
        {isCurrent
          ? 'Approved & issued ✓'
          : submitting
            ? 'Hashing exact quote…'
            : 'Approve exact quote →'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

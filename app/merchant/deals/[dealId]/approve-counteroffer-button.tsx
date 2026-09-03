'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type ApproveCounterofferButtonProps = {
  dealId: string;
  counterofferId: string;
};

export function ApproveCounterofferButton({
  dealId,
  counterofferId,
}: ApproveCounterofferButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function approve() {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        `/api/merchant/deals/${dealId}/counteroffers/${counterofferId}/approve`,
        { method: 'POST' },
      );
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? 'The counteroffer was not approved.');
      }
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The counteroffer was not approved.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="counteroffer-approval-control">
      <button type="button" onClick={approve} disabled={submitting}>
        {submitting ? 'Approving offer…' : 'Approve reduction'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

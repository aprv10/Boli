'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function FulfilmentFailureButton({ dealId, disabled }: { dealId: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function trigger() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/merchant/deals/${dealId}/fulfilment-failure`, {
        method: 'POST',
      });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? 'Failure scenario could not run.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failure scenario could not run.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fulfilment-demo-control">
      <button type="button" disabled={disabled || busy} onClick={trigger}>
        {busy ? 'Checking locked constraints…' : 'Trigger stock-loss recovery →'}
      </button>
      <small>Local demo only · tries a dairy substitute, blocks it, then offers a vegan recovery.</small>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

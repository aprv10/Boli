'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export function RejectCounterofferButton({ dealId, counterofferId }: { dealId: string; counterofferId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function reject() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/merchant/deals/${dealId}/counteroffers/${counterofferId}/reject`, { method: 'POST' });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'Could not decline the offer.');
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Please refresh and try again.'); }
    finally { setBusy(false); }
  }
  return <div><button type="button" className="subtle-button" disabled={busy} onClick={reject}>{busy ? 'Saving…' : 'Decline reduction'}</button>{error ? <p role="alert">{error}</p> : null}</div>;
}

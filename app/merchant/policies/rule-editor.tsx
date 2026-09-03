'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
export function RuleEditor({ version, margin, concession }: { version: number; margin: number; concession: number }) {
  const router = useRouter();
  const [minimum, setMinimum] = useState(String(margin / 100));
  const [maximum, setMaximum] = useState(String(concession / 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/merchant/rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: version, minimumMarginBps: Math.round(Number(minimum) * 100), maximumAutomaticConcessionBps: Math.round(Number(maximum) * 100) }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error);
      setNotice('Rules saved. New offers use these limits; existing orders are not repriced.'); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save.'); }
    finally { setBusy(false); }
  }
  return <form className="working-rules" onSubmit={save}>
    <label><div><strong>Minimum profit margin</strong><p>Reject any proposed offer below this margin.</p></div><span><input aria-label="Minimum profit margin percent" type="number" required min="0" max="95" step=".01" value={minimum} onChange={event => setMinimum(event.target.value)} /> %</span></label>
    <label><div><strong>Automatic price-reduction limit</strong><p>Ask for your approval when a lower bundle price exceeds this reduction. The margin floor always applies.</p></div><span><input aria-label="Automatic price-reduction limit percent" type="number" required min="0" max="50" step=".01" value={maximum} onChange={event => setMaximum(event.target.value)} /> %</span></label>
    <footer><p>Buyer approval is always required before payment. Refunds require the buyer’s explicit request.</p><button disabled={busy}>{busy ? 'Saving…' : 'Save rules'}</button></footer>
    {error ? <p className="flow-error" role="alert">{error}</p> : null}{notice ? <p className="shopping-notice" role="status">{notice}</p> : null}
  </form>;
}

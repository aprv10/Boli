'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
type Props = {
  publicToken: string; quoteHash: string;
  suggestion: { product: { name: string; unitPricePaise: number }; remainingBudgetPaise: number; originalOrderPaise: number; finalOrderPaise: number; incrementalRevenuePaise: number; liftBps: number };
};
const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
export function UpsellCard({ publicToken, quoteHash, suggestion }: Props) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [dismissed, setDismissed] = useState(false);
  async function accept() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/public/deals/${publicToken}/upsell`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedQuoteHash: quoteHash }) });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'This add-on is no longer available.');
      router.refresh(); setDismissed(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not add this item. Please try again.'); }
    finally { setBusy(false); }
  }
  if (dismissed) return null;
  return <section className="order-addon"><div><span>One more thing that fits</span><h2>{suggestion.product.name}</h2><p>You have {money(suggestion.remainingBudgetPaise)} per kit left in your budget. Add this for {money(suggestion.product.unitPricePaise)} per kit.</p><small>Meets your requirements, available quantity and delivery date.</small></div>
    <div className="addon-total"><span>New order total</span><strong>{money(suggestion.finalOrderPaise)}</strong><small>Currently {money(suggestion.originalOrderPaise)}</small></div>
    <footer><button type="button" onClick={accept} disabled={busy}>{busy ? 'Adding item…' : 'Add to each kit'}</button><button type="button" className="subtle-button" disabled={busy} onClick={() => setDismissed(true)}>No thanks</button></footer>
    {error ? <p role="alert" className="flow-error">{error}</p> : null}
  </section>;
}

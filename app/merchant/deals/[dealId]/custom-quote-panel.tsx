'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { QuoteOption } from '@/src/domain/quoting/types';
import type { CustomRequirement } from '@/src/domain/quoting/custom-requirements';
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);

export function CustomQuotePanel({ dealId, note, requirements, options }: { dealId: string; note: string; requirements: CustomRequirement[]; options: QuoteOption[] }) {
  const router = useRouter();
  const [key, setKey] = useState<string>(options[0]?.key ?? '');
  const [action, setAction] = useState(options.length ? 'quote' : 'needs_changes');
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = options.find(option => option.key === key);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`/api/merchant/deals/${dealId}/custom-quote`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, message, optionKey: key, expectedOption: JSON.stringify(selected), confirmed }) });
      const data = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? 'The response could not be saved.');
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Try again.'); setBusy(false); }
  }
  return <section className="merchant-content custom-quote-review"><div className="shopping-section-heading"><div><h2>Review a buyer’s request</h2><p>Reply with a checked offer, ask for changes, or decline.</p></div><span className="status-pill status-attention">Needs your response</span></div>
    <blockquote>{note}</blockquote>
    {requirements.length ? <ul className="requirement-list">{requirements.map((item, index) => <li key={index}><strong>{item.text}</strong><span>{item.priority === 'required' ? 'Required · confirm before quoting' : 'Preference · explain whether included'}</span></li>)}</ul> : null}
    <form onSubmit={submit} className="store-reply-form">
      <label>Your response<select value={action} disabled={busy} onChange={event => setAction(event.target.value)}>{options.length ? <option value="quote">Send a checked offer</option> : null}<option value="needs_changes">Ask buyer to revise the request</option><option value="declined">Cannot fulfil this request</option></select></label>
      {action === 'quote' && selected ? <><label>Offer<select value={key} disabled={busy} onChange={event => { setKey(event.target.value); setConfirmed(false); }}>{options.map(option => <option key={option.key} value={option.key}>{option.label} · {money(option.unitTotalPaise)} / unit · {(option.contributionMarginBps / 100).toFixed(1)}% margin</option>)}</select></label>
        <div className="merchant-table-wrap"><table className="merchant-table"><thead><tr><th>Item / service</th><th>Price / unit</th></tr></thead><tbody>{selected.lines.map(line => <tr key={line.code}><td>{line.label}</td><td>{money(line.unitPricePaise)}</td></tr>)}</tbody></table></div>
        <p>Total: <strong>{money(selected.orderTotalPaise)}</strong>. Prices come from the catalog and rules; extra work is not silently charged.</p>
        <label className="requirement-confirm"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>I can fulfil every required item and condition for these exact products, delivery date and total. I will explain any unmet preferences below.</span></label></> : !options.length ? <p>No catalog option currently passes budget, stock, delivery and margin checks. Ask the buyer to revise their details; a payable offer cannot be sent yet.</p> : null}
      <label>Reply to the buyer<textarea required minLength={10} maxLength={600} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} placeholder="Explain what is included, or exactly what needs to change." /></label>
      {error ? <p className="flow-error" role="alert">{error}</p> : null}<button disabled={busy}>{busy ? 'Saving response…' : action === 'quote' ? 'Confirm requirements & send offer' : 'Send response'}</button>
    </form>
  </section>;
}

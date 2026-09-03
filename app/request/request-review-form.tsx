'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Plus, X } from 'lucide-react';
import type { Draft } from './request-draft';
import { requiresMerchantReview } from '@/src/domain/quoting/custom-requirements';
const labels = { vegan: 'Vegan', 'plastic-free': 'Plastic-free', branded: 'Add my branding', 'multi-city': 'Multiple cities' } as const;
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value / 100);

export function RequestReviewForm({ draft, onChange, onSubmit, busy, submitLabel, submitHint }: { draft: Draft; onChange: (draft: Draft) => void; onSubmit: (event: FormEvent) => void; busy: string; submitLabel?: string; submitHint?: string }) {
  const [text, setText] = useState('');
  const [priority, setPriority] = useState<'required' | 'preferred'>('required');
  const [error, setError] = useState('');
  const unit = draft.mode === 'kit' ? 'kit' : 'item';
  const manual = requiresMerchantReview(draft.custom);
  function update<K extends keyof Draft>(field: K, value: Draft[K]) { onChange({ ...draft, [field]: value }); }
  function add() {
    if (text.trim().length < 3) { setError('Describe the requirement in at least three characters.'); return; }
    if (draft.custom.length >= 12) { setError('You can add up to 12 specific requirements.'); return; }
    if (draft.custom.some(item => item.text.toLowerCase() === text.trim().toLowerCase())) { setError('That requirement is already on your list.'); return; }
    update('custom', [...draft.custom, { text: text.trim(), priority }]); setText(''); setError('');
  }
  function submit(event: FormEvent) {
    if (text.trim()) { event.preventDefault(); setError('Add the requirement you typed, or clear it before continuing.'); return; }
    setError(''); onSubmit(event);
  }
  return <form className="request-review request-refined" onSubmit={submit}>
    <fieldset className="request-group review-wide"><legend>What you need</legend><div className="purchase-choice">{(['product','kit'] as const).map(mode => <label key={mode}><input type="radio" name="shopping-mode" required checked={draft.mode === mode} disabled={Boolean(busy)} onChange={() => update('mode', mode)} /><span>{mode === 'product' ? 'A product' : 'Welcome kits'}</span></label>)}</div>
      {draft.mode === 'product' ? <label>Product<input required maxLength={120} value={draft.query} disabled={Boolean(busy)} onChange={event => update('query', event.target.value)} placeholder="e.g. steel bottles" /><small>One product type per request. <Link href="/catalog">Choose from the catalog</Link></small></label> : draft.mode === 'kit' ? <p>A bag or box, drinkware, stationery, a snack and packaging in each kit.</p> : <p>Choose a product or a ready-to-build welcome kit.</p>}
    </fieldset>
    <label>How many?<input type="number" min="1" max="10000" step="1" required value={draft.quantity} disabled={Boolean(busy)} onChange={event => update('quantity', event.target.value)} placeholder="Quantity" /></label>
    <div className="budget-field"><label htmlFor="request-amount">Your maximum budget</label><div className="amount-input"><span aria-hidden="true">₹</span><input id="request-amount" type="number" min="1" max="10000000" step=".01" required value={draft.budget} disabled={Boolean(busy)} onChange={event => update('budget', event.target.value)} placeholder="Amount" /></div><div className="budget-choice" role="group" aria-label="Budget applies to">{(['per_unit','total'] as const).map(kind => <button type="button" key={kind} aria-pressed={draft.budgetKind === kind} disabled={Boolean(busy)} onClick={() => update('budgetKind', kind)}>{kind === 'total' ? 'Whole order' : `Per ${unit}`}</button>)}</div>{Number(draft.quantity) > 0 && Number(draft.budget) > 0 ? <small>{draft.budgetKind === 'total' ? `Up to ${money(Math.floor(Number(draft.budget) * 100 / Number(draft.quantity)))} per ${unit}` : `Up to ${money(Math.round(Number(draft.budget) * 100) * Number(draft.quantity))} for the order`} · services included</small> : <small>Includes the products and applicable services.</small>}</div>
    <label>Deliver to<input required maxLength={800} disabled={Boolean(busy)} value={draft.locations} onChange={event => update('locations', event.target.value)} placeholder="e.g. Hyderabad, Chennai" /><small>Separate multiple cities with commas.</small></label>
    <label>Needed by<input type="date" required min={new Date().toISOString().slice(0, 10)} disabled={Boolean(busy)} value={draft.deadline} onChange={event => update('deadline', event.target.value)} /></label>
    <fieldset className="request-group review-wide"><legend>Anything the order must meet?</legend><p>These are checked against the catalog and delivery details.</p><div className="requirement-presets">{(Object.keys(labels) as Array<keyof typeof labels>).map(constraint => <label key={constraint}><input type="checkbox" disabled={Boolean(busy)} checked={draft.constraints.includes(constraint)} onChange={event => update('constraints', event.target.checked ? [...draft.constraints, constraint] : draft.constraints.filter(item => item !== constraint))} />{labels[constraint]}</label>)}</div>
      <div className="custom-requirements"><label htmlFor="custom-requirement">Add a specific requirement</label><div className="requirement-entry"><input id="custom-requirement" value={text} maxLength={200} disabled={Boolean(busy)} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} placeholder="e.g. a handwritten note in every kit" /><select aria-label="Requirement priority" value={priority} disabled={Boolean(busy)} onChange={event => setPriority(event.target.value as 'required' | 'preferred')}><option value="required">Required</option><option value="preferred">Nice to have</option></select><button type="button" className="subtle-button" disabled={Boolean(busy) || !text.trim()} onClick={add}><Plus size={15} /> Add</button></div>
        {draft.custom.length ? <ul className="requirement-list">{draft.custom.map((item, index) => <li key={`${item.text}:${index}`}><div><strong>{item.text}</strong><span>{item.priority === 'required' ? 'Required · needs store confirmation' : 'Nice to have · not guaranteed'}</span></div><div><select aria-label={`Priority for ${item.text}`} value={item.priority} disabled={Boolean(busy)} onChange={event => update('custom', draft.custom.map((entry, at) => at === index ? { ...entry, priority: event.target.value as 'required' | 'preferred' } : entry))}><option value="required">Required</option><option value="preferred">Nice to have</option></select><button type="button" className="icon-button" aria-label={`Remove ${item.text}`} disabled={Boolean(busy)} onClick={() => update('custom', draft.custom.filter((_, at) => at !== index))}><X size={16} /></button></div></li>)}</ul> : null}
        <small>Specific requirements aren’t automatically verified. Required ones go to the store before an offer can be sent.</small>
      </div>
    </fieldset>
    {error ? <p className="flow-error review-wide" role="alert">{error}</p> : null}
    <footer className="review-wide"><span>{manual ? 'The store will review your requirements. No payment is taken.' : submitHint ?? 'Next: compare products, delivery and total prices.'}</span><button disabled={Boolean(busy)}>{busy || (manual ? 'Send to store for review' : submitLabel ?? 'Find offers')} <ArrowRight size={16} /></button></footer>
  </form>;
}

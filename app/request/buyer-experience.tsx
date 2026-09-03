'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, Check, LoaderCircle, Pencil, Package, Search } from 'lucide-react';
import type { RfqInterpretation } from '@/src/application/agent/rfq-contract';
import { TextGenerateEffect } from '../components/ui/text-generate-effect';

type Draft = {
  quantity: string; budget: string; budgetKind: string; locations: string; deadline: string;
  mode: string; query: string; constraints: string[]; unsupported: string[];
};
const emptyDraft = (): Draft => ({ quantity: '', budget: '', budgetKind: '', locations: '', deadline: '', mode: '', query: '', constraints: [], unsupported: [] });
type Option = {
  key: string; label: string; recommended: boolean; rationale: string; unitTotalPaise: number; orderTotalPaise: number;
  deliveryDays: number; satisfiedConstraints: string[];
  lines: { code: string; label: string; kind: string; unitPricePaise: number; productId?: string }[];
};
const examples = ['50 steel bottles, ₹400 each, delivered to Hyderabad within 3 weeks.', '30 welcome kits, ₹900 per kit, vegan, Chennai, within 3 weeks.'];
const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(paise / 100);

export function BuyerExperience({ home = false, initialProduct = '', children }: { home?: boolean; initialProduct?: string; children?: ReactNode }) {
  const [brief, setBrief] = useState(initialProduct ? `I need ${initialProduct}.` : '');
  const [stage, setStage] = useState<'input' | 'review' | 'options'>('input');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [question, setQuestion] = useState('');
  const [runId, setRunId] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [dealId, setDealId] = useState('');
  const [selecting, setSelecting] = useState('');
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const previousStage = useRef(stage);

  useEffect(() => {
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    const frame = requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      sectionRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [stage]);

  useEffect(() => {
    if (!error || !errorRef.current) return;
    const element = errorRef.current;
    element.focus({ preventScroll: true });
    const bounds = element.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
      element.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  }, [error]);

  async function interpret(event: FormEvent) {
    event.preventDefault(); setBusy('Understanding your request'); setError(''); setNotice(''); setQuestion(''); setRunId('');
    let next = emptyDraft();
    try {
      const response = await fetch('/api/agent/interpret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief }) });
      const data = await response.json() as { interpretation?: RfqInterpretation; runId?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? 'Boli could not interpret your request. Enter the details below; nothing has been assumed.');
      if (!data.interpretation) throw new Error('The interpretation response was incomplete. Enter the details below; nothing has been assumed.');
      const p = data.interpretation;
      next = { quantity: p.quantity == null ? '' : String(p.quantity), budget: p.budgetInr == null ? '' : String(p.budgetInr), budgetKind: p.budgetKind === 'unknown' ? '' : p.budgetKind,
        locations: p.deliveryLocations.join(', '), deadline: p.deadline ?? '', mode: p.shoppingMode === 'unknown' ? '' : p.shoppingMode, query: p.productQuery ?? '',
        constraints: p.hardConstraints ?? [], unsupported: p.unsupportedRequirements ?? [] };
      setRunId(data.runId ?? ''); setQuestion(p.clarifyingQuestion ?? '');
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Please enter your requirements below.');
    } finally { setDraft(next); setStage('review'); setBusy(''); }
  }

  function update(field: keyof Draft, value: string) { setDraft(current => ({ ...current, [field]: value })); }
  async function findOptions(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    if (draft.unsupported.length) { setError('Please revise the request. The listed requirements cannot be verified by this catalog.'); return; }
    const quantity = Number(draft.quantity);
    const budgetPaise = Math.round(Number(draft.budget) * 100);
    const maxUnitPaise = draft.budgetKind === 'total' ? Math.floor(budgetPaise / quantity) : budgetPaise;
    const deliveryLocations = draft.locations.split(',').map(value => value.trim()).filter(Boolean);
    if (draft.constraints.includes('multi-city') && new Set(deliveryLocations.map(city => city.toLowerCase())).size < 2) { setError('Add at least two different delivery cities, or remove the multi-city requirement.'); return; }
    if (!Number.isInteger(quantity) || quantity < 1 || !Number.isSafeInteger(maxUnitPaise) || maxUnitPaise < 100 || !deliveryLocations.length) { setError('Check your quantity, budget and delivery locations.'); return; }
    setBusy('Checking products, prices and availability');
    try {
      const response = await fetch('/api/intents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        rawText: brief, quantity, maxUnitPaise, deliveryLocations, deadline: draft.deadline, hardConstraints: draft.constraints,
        selection: { mode: draft.mode, query: draft.query }, unsupportedRequirements: draft.unsupported,
        ...(runId ? { agentRunId: runId, agentReviewStatus: 'modified' } : {}),
      }) });
      const data = await response.json() as { deal?: { id: string }; error?: { message?: string } };
      if (!response.ok || !data.deal) throw new Error(data.error?.message ?? 'We could not save this request.');
      setDealId(data.deal.id);
      const quotes = await fetch(`/api/deals/${data.deal.id}/quotes`);
      const result = await quotes.json() as { options?: Option[]; rejectionReasons?: Array<{ message: string }>; error?: { message?: string } };
      if (!quotes.ok) throw new Error(result.error?.message ?? 'Products could not be checked.');
      setOptions(result.options ?? []);
      if (!result.options?.length) setNotice(result.rejectionReasons?.map((reason: { message: string }) => reason.message).join(' ') ?? 'No products match these requirements.');
      setStage('options');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Please try again.'); }
    finally { setBusy(''); }
  }
  async function choose(option: Option) {
    setSelecting(option.key); setError('');
    try {
      const response = await fetch(`/api/deals/${dealId}/quotes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionKey: option.key }) });
      const data = await response.json() as { dealRoomPath?: string; error?: { message?: string } };
      if (!response.ok || !data.dealRoomPath) throw new Error(data.error?.message ?? 'This offer changed. Please check again.');
      window.location.assign(data.dealRoomPath);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Please try again.'); setSelecting(''); }
  }
  return <><section id="start-shopping" ref={sectionRef} tabIndex={-1} aria-labelledby="buyer-step-title" className={stage === 'input' ? 'shopping-start' : 'shopping-workspace'}>
    {stage === 'input' ? <>
      <div className="shopping-intro"><span className="composer-kicker">A better way to buy</span>
        <h1 id="buyer-step-title" ref={headingRef} tabIndex={-1}>{home ? <><TextGenerateEffect words="Say what you need." /><br /><em className="hero-deal-line"><TextGenerateEffect words="Find a deal that fits." delay={130} /></em></> : 'What do you need?'}</h1>
        <p>Explore products, ask for a better offer, and make it yours.</p>
      </div>
      <form className="shopping-composer" onSubmit={interpret}>
        <label htmlFor="buyer-brief">What are you looking for?</label>
        <textarea id="buyer-brief" placeholder="Tell us the product, quantity, budget and when you need it…" value={brief} onChange={event => setBrief(event.target.value)} minLength={3} maxLength={600} required disabled={Boolean(busy)} />
        <div><Link href="/catalog"><Search size={15} /> Browse products</Link><button disabled={Boolean(busy)}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={18} />} {busy || 'Find my options'}</button></div>
      </form>
      <div className="shopping-examples"><span>Try a request</span>{examples.map(example => <button type="button" key={example} onClick={() => setBrief(example)} disabled={Boolean(busy)}>{example}</button>)}</div>
      <p className="shopping-assurance"><Check size={14} /> You review the items and total before anything is purchased.</p>
      {home ? <a className="home-scroll-cue" href="#how-boli-works"><span>There’s more to Boli</span><ArrowDown size={16} /></a> : null}
    </> : null}
    {stage === 'review' ? <>
      <header className="shopping-section-heading"><div><span>YOUR REQUEST</span><h1 id="buyer-step-title" ref={headingRef} tabIndex={-1}>Let’s get the details right.</h1><p>{brief}</p></div><button type="button" onClick={() => { setStage('input'); setError(''); }} disabled={Boolean(busy)}><Pencil size={14} /> Edit request</button></header>
      {notice ? <p className="shopping-notice" role="status">{notice}</p> : null}
      {question ? <p className="shopping-question">{question}</p> : null}
      {draft.unsupported.length ? <div className="flow-error" role="alert"><strong>We cannot verify these requirements yet:</strong><ul>{draft.unsupported.map(item => <li key={item}>{item}</li>)}</ul><p>Revise the request or browse the catalog. These requirements will not be silently dropped.</p></div> : null}
      <form className="request-review" onSubmit={findOptions}>
        <label>What are you buying?<select required value={draft.mode} onChange={event => update('mode', event.target.value)}><option value="">Choose a purchase type</option><option value="kit">Welcome kits</option><option value="product">A product from the catalog</option></select></label>
        {draft.mode === 'product' ? <label>Product name or type<input required maxLength={120} value={draft.query} onChange={event => update('query', event.target.value)} placeholder="e.g. steel bottle" /><small>One product type per request. <Link href="/catalog">See the catalog</Link></small></label> : <p className="review-help">Welcome kits contain a bag or box, drinkware, stationery, a snack and packaging.</p>}
        <label>Quantity<input type="number" min="1" max="10000" step="1" required value={draft.quantity} onChange={event => update('quantity', event.target.value)} /></label>
        <label>Budget type<select required value={draft.budgetKind} onChange={event => update('budgetKind', event.target.value)}><option value="">Choose</option><option value="per_unit">Per item / kit</option><option value="total">Entire order</option></select></label>
        <label>Maximum budget (₹)<input type="number" min="1" max="10000000" step=".01" required value={draft.budget} onChange={event => update('budget', event.target.value)} /></label>
        <label>Deliver by<input type="date" required min={new Date().toISOString().slice(0, 10)} value={draft.deadline} onChange={event => update('deadline', event.target.value)} /></label>
        <label className="review-wide">Delivery cities<input required value={draft.locations} onChange={event => update('locations', event.target.value)} placeholder="Separate cities with commas" /></label>
        <fieldset className="review-wide"><legend>Your requirements</legend><p>Only select what you need. None are added by default.</p><div>{['vegan', 'plastic-free', 'branded', 'multi-city'].map(constraint => <label key={constraint}><input type="checkbox" checked={draft.constraints.includes(constraint)} onChange={event => setDraft(current => ({ ...current, constraints: event.target.checked ? [...current.constraints, constraint] : current.constraints.filter(item => item !== constraint) }))} />{constraint.replace('-', ' ')}</label>)}</div></fieldset>
        <footer className="review-wide"><span>These are the details Boli will use to find your options.</span><button disabled={Boolean(busy) || draft.unsupported.length > 0}>{busy || 'Confirm & find options'} <ArrowRight size={16} /></button></footer>
      </form>
    </> : null}
    {stage === 'options' ? <>
      <header className="shopping-section-heading"><div><span>{options.length ? `${options.length} AVAILABLE ${options.length === 1 ? 'OPTION' : 'OPTIONS'}` : 'NO MATCH YET'}</span><h1 id="buyer-step-title" ref={headingRef} tabIndex={-1}>{options.length ? 'Here’s what fits.' : 'Let’s adjust the request.'}</h1><p>{draft.quantity} {draft.mode === 'kit' ? 'kits' : 'items'} · {draft.locations} · By {draft.deadline}</p></div><button type="button" onClick={() => { setStage('review'); setError(''); }} disabled={Boolean(selecting)}>Edit details</button></header>
      {options.length === 1 ? <p className="shopping-notice">Only one configuration currently meets your product, budget, stock and delivery requirements. You can edit your details to explore alternatives.</p> : null}
      {!options.length ? <div className="shopping-empty"><Package size={34} /><p>{notice}</p><Link href="/catalog">Browse available products →</Link></div> : <div className="shopping-options">{options.map(option => <article className={option.recommended ? 'shopping-option recommended' : 'shopping-option'} key={option.key}>
        <header><span>{option.label}</span>{option.recommended ? <b>Recommended</b> : null}</header>
        <div className="option-products">{option.lines.filter(line => line.kind === 'product').map(line => <div key={line.code}><Package size={21} /><div><strong>{line.label}</strong><span>{draft.quantity} × {money(line.unitPricePaise)}</span></div></div>)}</div>
        <div className="option-price"><strong>{money(option.orderTotalPaise)}</strong><span>{money(option.unitTotalPaise)} per {draft.mode === 'kit' ? 'kit' : 'item'} · including services</span></div>
        <p className="option-delivery">Estimated delivery: {option.deliveryDays} days</p>
        <div className="constraint-ticks">{option.satisfiedConstraints.map(item => <span key={item}>✓ {item.replace('-', ' ')}</span>)}</div>
        <details><summary>Price breakdown & why this?</summary><p>{option.rationale}</p>{option.lines.filter(line => line.kind !== 'product').map(line => <p key={line.code}>{line.label}: {money(line.unitPricePaise)} per {draft.mode === 'kit' ? 'kit' : 'item'}</p>)}</details>
        <button type="button" disabled={Boolean(selecting)} onClick={() => choose(option)}>{selecting === option.key ? 'Preparing order…' : 'Review this order'} <ArrowRight size={16} /></button>
      </article>)}</div>}
    </> : null}
    {error ? <p ref={errorRef} tabIndex={-1} className="flow-error" role="alert">{error}</p> : null}
  </section>{home && stage === 'input' ? children : null}</>;
}

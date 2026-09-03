'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, Check, LoaderCircle, Pencil, Package, Search } from 'lucide-react';
import type { RfqInterpretation } from '@/src/application/agent/rfq-contract';
import { BuyerProgress } from '../buyer-progress';
import { RequestReviewForm } from './request-review-form';
import { draftFromInterpretation, emptyDraft, readDraft, saveDraft, type Draft } from './request-draft';
import { requiresMerchantReview } from '@/src/domain/quoting/custom-requirements';
type Option = {
  key: string; label: string; recommended: boolean; rationale: string; unitTotalPaise: number; orderTotalPaise: number;
  deliveryDays: number; satisfiedConstraints: string[]; recommendationSource?: 'mistral' | 'deterministic';
  lines: { code: string; label: string; kind: string; unitPricePaise: number; productId?: string }[];
};
const examples = ['80 welcome kits, ₹900 per kit, vegan, plastic-free, Hyderabad and Chennai, within 3 weeks.', '50 steel bottles, ₹400 each, delivered to Hyderabad within 3 weeks.'];
const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(paise / 100);

export function BuyerExperience({ home = false, initialProduct = '', restoreDraft = false, children }: { home?: boolean; initialProduct?: string; restoreDraft?: boolean; children?: ReactNode }) {
  const router = useRouter();
  const [brief, setBrief] = useState(initialProduct ? `I need ${initialProduct}.` : '');
  const [stage, setStage] = useState<'input' | 'review' | 'options'>(initialProduct ? 'review' : 'input');
  const [draft, setDraft] = useState<Draft>(() => ({ ...emptyDraft(), ...(initialProduct ? { mode: initialProduct.toLowerCase() === 'welcome kits' ? 'kit' as const : 'product' as const, query: initialProduct } : {}) }));
  const [restoring, setRestoring] = useState(restoreDraft);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [question, setQuestion] = useState('');
  const [runId, setRunId] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [dealId, setDealId] = useState('');
  const [publicToken, setPublicToken] = useState('');
  const [selecting, setSelecting] = useState('');
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const previousStage = useRef(stage);
  const orderPath = (token: string) => `${home ? '/' : '/request'}?order=${encodeURIComponent(token)}`;

  useEffect(() => {
    if (!restoreDraft) return;
    // Restore browser-owned state after hydration; the placeholder prevents a
    // blank form from flashing or overwriting the saved draft in the meantime.
    const frame = requestAnimationFrame(() => {
      const saved = readDraft();
      if (saved) { setBrief(saved.brief); setDraft(saved.draft); setRunId(saved.runId); setNotice(saved.notice ?? ''); setQuestion(saved.question ?? ''); setStage('review'); }
      setRestoring(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [restoreDraft]);
  useEffect(() => { if (!restoring && stage !== 'input') saveDraft({ brief, draft, runId, notice, question }); }, [brief, draft, runId, notice, question, stage, restoring]);

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
    let next = emptyDraft(), nextRun = '', nextNotice = '', nextQuestion = '';
    try {
      const response = await fetch('/api/agent/interpret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief }) });
      const data = await response.json() as { interpretation?: RfqInterpretation; runId?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? 'Boli could not interpret your request. Enter the details below; nothing has been assumed.');
      if (!data.interpretation) throw new Error('The interpretation response was incomplete. Enter the details below; nothing has been assumed.');
      const p = data.interpretation;
      next = draftFromInterpretation(p);
      nextRun = data.runId ?? ''; nextQuestion = p.clarifyingQuestion ?? '';
    } catch (caught) {
      nextNotice = caught instanceof Error ? caught.message : 'Please enter your requirements below.';
    }
    const saved = saveDraft({ brief, draft: next, runId: nextRun, notice: nextNotice, question: nextQuestion });
    setDraft(next); setRunId(nextRun); setNotice(nextNotice); setQuestion(nextQuestion); setStage('review'); setBusy('');
    // Keep the existing workspace and remove any landing-section hash.
    window.history.replaceState(window.history.state, '', `${home ? '/' : '/request'}${saved ? '?draft=1' : ''}`);
  }

  async function findOptions(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    const manualReview = requiresMerchantReview(draft.custom);
    const quantity = Number(draft.quantity);
    const budgetPaise = Math.round(Number(draft.budget) * 100);
    const maxUnitPaise = draft.budgetKind === 'total' ? Math.floor(budgetPaise / quantity) : budgetPaise;
    const deliveryLocations = draft.locations.split(',').map(value => value.trim()).filter(Boolean);
    if (draft.constraints.includes('multi-city') && new Set(deliveryLocations.map(city => city.toLowerCase())).size < 2) { setError('Add at least two different delivery cities, or remove the multi-city requirement.'); return; }
    if (!Number.isInteger(quantity) || quantity < 1 || !Number.isSafeInteger(maxUnitPaise) || maxUnitPaise < 100 || !deliveryLocations.length) { setError('Check your quantity, budget and delivery locations.'); return; }
    setBusy(manualReview ? 'Sending your request to the store' : 'Checking products, prices and availability');
    try {
      const response = await fetch('/api/intents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        rawText: brief, quantity, maxUnitPaise, deliveryLocations, deadline: draft.deadline, hardConstraints: draft.constraints,
        selection: { mode: draft.mode, query: draft.query }, customRequirements: draft.custom, requestMerchantReview: manualReview,
        ...(runId ? { agentRunId: runId, agentReviewStatus: 'modified' } : {}),
      }) });
      const data = await response.json() as { deal?: { id: string; publicToken: string }; error?: { message?: string } };
      if (!response.ok || !data.deal) throw new Error(data.error?.message ?? 'We could not save this request.');
      setDealId(data.deal.id);
      setPublicToken(data.deal.publicToken);
      if (manualReview) { router.push(orderPath(data.deal.publicToken)); return; }
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
      router.push(orderPath(publicToken));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Please try again.'); setSelecting(''); }
  }
  async function askStore() {
    setSelecting('custom'); setError('');
    try {
      const response = await fetch(`/api/public/deals/${publicToken}/custom-quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: brief }) });
      const data = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? 'Your request could not be sent.');
      router.push(orderPath(publicToken));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Please try again.'); setSelecting(''); }
  }
  if (restoring) return <section className="shopping-workspace" aria-live="polite"><p>Opening your request…</p></section>;
  return <><section id="start-shopping" ref={sectionRef} tabIndex={-1} aria-labelledby="buyer-step-title" className={stage === 'input' ? 'shopping-start' : 'shopping-workspace'}>
    {stage !== 'input' ? <BuyerProgress step={stage === 'review' ? 0 : 1} /> : null}
    {stage === 'input' ? <>
      <div className="shopping-intro"><span className="composer-kicker">Commerce for the agentic internet</span>
        <h1 id="buyer-step-title" ref={headingRef} tabIndex={-1}>{home ? <>Say what you need.<br /><em className="hero-deal-line">Find a deal that fits.</em></> : 'What do you need?'}</h1>
        <p>Describe your order. Compare offers. Negotiate and pay—all here.</p>
      </div>
      <form className="shopping-composer" onSubmit={interpret}>
        <label htmlFor="buyer-brief">What are you looking for?</label>
        <textarea id="buyer-brief" placeholder="Tell us the product, quantity, budget and when you need it…" value={brief} onChange={event => setBrief(event.target.value)} minLength={3} maxLength={600} required disabled={Boolean(busy)} />
        <div><Link href="/catalog"><Search size={15} /> Browse products</Link><button disabled={Boolean(busy)}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={18} />} {busy || 'Start my request'}</button></div>
      </form>
      <div className="shopping-examples"><span>Try a request</span>{examples.map(example => <button type="button" key={example} onClick={() => setBrief(example)} disabled={Boolean(busy)}>{example}</button>)}</div>
      <p className="shopping-assurance"><Check size={14} /> You review the items and total before anything is purchased.</p>
      {home ? <a className="home-scroll-cue" href="#how-boli-works"><span>There’s more to Boli</span><ArrowDown size={16} /></a> : null}
    </> : null}
    {stage === 'review' ? <>
      <header className="shopping-section-heading"><div><span>{runId ? 'INTENT UNDERSTOOD' : 'YOUR REQUEST'}</span><h1 id="buyer-step-title" ref={headingRef} tabIndex={-1}>Does this look right?</h1><p>Check the details below, then find offers that fit.</p></div><button type="button" onClick={() => { setStage('input'); setError(''); window.history.replaceState(window.history.state, '', home ? '/' : '/request'); }} disabled={Boolean(busy)}><Pencil size={14} /> Rewrite request</button></header>
      {notice ? <p className="shopping-notice" role="status">{notice}</p> : null}
      {question ? <p className="shopping-question">{question}</p> : null}
      <RequestReviewForm draft={draft} onChange={setDraft} onSubmit={findOptions} busy={busy} />
    </> : null}
    {stage === 'options' ? <>
      <header className="shopping-section-heading"><div><span>{options.length ? `${options.length} ${options.length === 1 ? 'OFFER' : 'OFFERS'} FOUND · MERCHANT RULES CHECKED` : 'NO MATCH YET'}</span><h1 id="buyer-step-title" ref={headingRef} tabIndex={-1}>{options.length ? 'Here’s what fits.' : 'Let’s adjust the request.'}</h1><p>{draft.quantity} {draft.mode === 'kit' ? 'kits' : 'items'} · {draft.locations} · By {new Date(`${draft.deadline}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p></div><button type="button" onClick={() => { setStage('review'); setError(''); }} disabled={Boolean(selecting)}>Edit details</button></header>
      {draft.custom.length ? <p className="shopping-notice">Preferences are saved but aren’t guaranteed by these offers: {draft.custom.map(item => item.text).join('; ')}.</p> : null}
      {options.length === 1 ? <p className="shopping-notice">Only one configuration currently meets your product, budget, stock and delivery requirements. You can edit your details to explore alternatives.</p> : null}
      {!options.length ? <div className="shopping-empty"><Package size={34} /><p>{notice}</p><Link href="/catalog">Browse available products →</Link></div> : <div className="shopping-options">{options.map(option => <article className={option.recommended ? 'shopping-option recommended' : 'shopping-option'} key={option.key}>
        <header><span>{option.recommended ? 'Best Value' : option.label}</span>{option.recommended ? <b>Recommended</b> : null}</header>
        <div className="option-price"><strong>{money(option.orderTotalPaise)}</strong><span>{money(option.unitTotalPaise)} per {draft.mode === 'kit' ? 'kit' : 'item'} · including services</span></div>
        <p className="option-delivery">Estimated delivery: {option.deliveryDays} days</p>
        <div className="constraint-ticks">{option.satisfiedConstraints.map(item => <span key={item}>✓ {item.replace('-', ' ')}</span>)}</div>
        <div className="option-products">{option.lines.filter(line => line.kind === 'product').map(line => <div key={line.code}><Package size={18} /><div><strong>{line.label}</strong><span>{draft.quantity} × {money(line.unitPricePaise)}</span></div></div>)}</div>
        <details><summary>Why this? & price breakdown</summary>{option.recommended && option.label !== 'Best Value' ? <p>Also: {option.label.toLowerCase()}.</p> : null}<p>{option.rationale.replaceAll('locked constraint', 'requirement').replaceAll('mandate', 'request').replaceAll('verified total', 'total')}</p>{option.lines.filter(line => line.kind !== 'product').map(line => <p key={line.code}>{line.label}: {money(line.unitPricePaise)} per {draft.mode === 'kit' ? 'kit' : 'item'}</p>)}{option.recommendationSource === 'mistral' ? <p>AI recommendation based on checked products, prices and delivery.</p> : null}</details>
        <button type="button" className={option.recommended ? undefined : 'subtle-button'} disabled={Boolean(selecting)} onClick={() => choose(option)}>{selecting === option.key ? 'Preparing your offer…' : option.recommended ? 'Choose Best Value' : 'Choose this offer'} <ArrowRight size={16} /></button>
      </article>)}</div>}
      <details className="custom-quote-invite"><summary>Need the store’s help?</summary><p>Send this request to the demo merchant for a personal review. To add requirements, edit your details first.</p><button className="subtle-button" type="button" onClick={askStore} disabled={Boolean(selecting)}>{selecting === 'custom' ? 'Sending…' : 'Ask the store for a quote'}</button></details>
    </> : null}
    {error ? <p ref={errorRef} tabIndex={-1} className="flow-error" role="alert">{error}</p> : null}
  </section>{home && stage === 'input' ? children : null}</>;
}

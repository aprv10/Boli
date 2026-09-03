'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BorderBeam } from './components/ui/border-beam';
import {
  BadgeIndianRupee,
  Box,
  Check,
  ChevronRight,
  CircleGauge,
  PackageCheck,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

const stages = [
  { label: 'Intent', detail: 'Requirements structured', icon: Sparkles },
  { label: 'Catalog', detail: 'Valid bundles compared', icon: Box },
  { label: 'Policy', detail: 'Every boundary passed', icon: ShieldCheck },
  { label: 'Checkout', detail: 'Authoritative order ready', icon: BadgeIndianRupee },
];

const phaseCopy = [
  { eyebrow: 'MANDATE EXTRACTED', title: '80 welcome kits', value: '₹900 cap', note: 'Vegan · No plastic · 2 cities' },
  { eyebrow: '3 VALID OPTIONS', title: 'Best Value', value: '₹852 / person', note: '14 days · all constraints satisfied' },
  { eyebrow: 'POLICY AUTHORIZED', title: 'Margin protected', value: '22.4%', note: 'Automatic authority · policy v1' },
  { eyebrow: 'RAZORPAY TEST MODE', title: 'Order ready', value: '₹68,160', note: 'Server price · inventory reserved' },
];

function subscribeToMotionPreference(callback: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

function getMotionPreference() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function LandingExperience() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, getMotionPreference, () => true);
  const playing = !paused && !reducedMotion;
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActive((current) => (current + 1) % stages.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [playing]);

  function tilt(event: React.PointerEvent<HTMLDivElement>) {
    const frame = frameRef.current;
    if (!frame || reducedMotion || event.pointerType !== 'mouse') return;
    const bounds = frame.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    frame.style.setProperty('--tilt-x', `${x * 3.5}deg`);
    frame.style.setProperty('--tilt-y', `${y * -3.5}deg`);
  }

  function resetTilt() {
    const frame = frameRef.current;
    if (!frame) return;
    frame.style.setProperty('--tilt-x', '0deg');
    frame.style.setProperty('--tilt-y', '0deg');
  }

  const copy = phaseCopy[active];

  return (
    <div className={`alive-demo-wrap${playing ? ' is-playing' : ''}`}>
      <div className="alive-preview-orbit" aria-hidden="true" />
      <div className="alive-float-chip alive-chip-one" aria-hidden="true"><PackageCheck size={16} /> Inventory mapped</div>
      <div className="alive-float-chip alive-chip-two" aria-hidden="true"><CircleGauge size={16} /> Margin protected</div>
      <div
        className="alive-demo-frame"
        ref={frameRef}
        onPointerMove={tilt}
        onPointerLeave={resetTilt}
      >
        <BorderBeam active={playing} />
        <header className="alive-demo-header">
          <div><span className="alive-demo-logo">B</span><p><strong>Boli</strong><small>Commerce orchestrator</small></p></div>
          <span className="alive-system-status"><i aria-hidden="true" /> Product preview</span>
        </header>

        <section className="alive-demo-prompt">
          <span>BUYER INTENT</span>
          <p>“80 welcome kits under ₹900. Vegan, no plastic, two cities.”</p>
        </section>

        <div className="alive-demo-pipeline">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            const complete = index < active;
            const current = index === active;
            return (
              <button
                type="button"
                className={`${complete ? 'complete' : ''} ${current ? 'current' : ''}`}
                onClick={() => { setActive(index); setPaused(true); }}
                key={stage.label}
                aria-label={`Show ${stage.label} stage`}
                aria-pressed={current}
              >
                <span>{complete ? <Check size={14} strokeWidth={3} /> : <Icon size={15} />}</span>
                <p><strong>{stage.label}</strong><small>{stage.detail}</small></p>
                <ChevronRight size={14} />
              </button>
            );
          })}
        </div>

        <section className="alive-demo-result" key={active} aria-label="Illustrative stage result">
          <div><span>{copy.eyebrow}</span><p>{copy.title}</p><small>{copy.note}</small></div>
          <strong>{copy.value}</strong>
        </section>

        <footer className="alive-demo-footer">
          <span><ShieldCheck size={14} /> Policies before payments.</span>
          <button type="button" onClick={() => setPaused((value) => !value)} disabled={reducedMotion} aria-label={reducedMotion ? 'Animation disabled by reduced-motion preference' : playing ? 'Pause preview animation' : 'Play preview animation'}>
            {playing ? <Pause size={13} /> : <Play size={13} />}
            {reducedMotion ? 'Motion off' : playing ? 'Pause' : 'Play'}
          </button>
        </footer>
      </div>
      <p className="alive-preview-caption"><span>01 — 04</span> Interactive walkthrough · illustrative data</p>
    </div>
  );
}

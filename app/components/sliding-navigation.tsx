'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef } from 'react';
import { NavigationLabel } from './navigation-label';

type NavigationItem = { key: string; label: string; href: string };

export function SlidingNavigation({ items, activeKey, variant = 'pill', label }: {
  items: readonly NavigationItem[];
  activeKey: string;
  variant?: 'pill' | 'underline';
  label: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const highlight = highlightRef.current;
    if (!nav || !highlight) return;
    let frame = 0;
    function measure() {
      if (!nav || !highlight) return;
      const active = nav.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
      if (!active) { highlight.style.opacity = '0'; return; }
      const top = variant === 'pill' ? active.offsetTop : active.offsetTop + active.offsetHeight - 2;
      highlight.style.width = `${active.offsetWidth}px`;
      highlight.style.height = `${variant === 'pill' ? active.offsetHeight : 2}px`;
      highlight.style.transform = `translate3d(${active.offsetLeft}px, ${top}px, 0)`;
      highlight.style.opacity = '1';
      if (!nav.dataset.highlightReady) {
        // Position before enabling transitions, avoiding a first-render sweep.
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => { nav.dataset.highlightReady = 'true'; });
      }
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    nav.querySelectorAll('a').forEach(link => observer.observe(link));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [activeKey, variant]);

  return <nav ref={navRef} className={`${variant === 'pill' ? 'site-navigation' : 'merchant-tabs'} sliding-navigation`} data-variant={variant} aria-label={label}>
    <span ref={highlightRef} className="navigation-highlight" aria-hidden="true" />
    {items.map(item => <Link key={item.key} href={item.href} className={variant === 'pill' ? `site-nav-link${activeKey === item.key ? ' site-nav-link-active' : ''}` : undefined} aria-current={activeKey === item.key ? 'page' : undefined}><NavigationLabel>{item.label}</NavigationLabel></Link>)}
  </nav>;
}
